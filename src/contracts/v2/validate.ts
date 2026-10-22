import { z } from 'zod';
import { contentHeadSchema, contentRevisionSchema, type ContentRevision } from './content.ts';
import {
  fieldRecordSchema,
  planVersionSchema,
  proposalSchema,
  tripHeaderSchema,
  type PlanVersion,
} from './planning.ts';
import { ensure, key, unique, type ContentRef, type RevisionRef, type TargetRef } from './primitives.ts';
import { canonicalJson } from './json.ts';

/** Validation aggregate only; persistence must use split stores through repository (P-02). */
export const tripDatasetSchema = z.strictObject({
  domainSchemaVersion: z.literal(2),
  header: tripHeaderSchema,
  heads: z.array(contentHeadSchema),
  contents: z.array(contentRevisionSchema),
  plans: z.array(planVersionSchema).min(1),
  records: z.array(fieldRecordSchema),
  proposals: z.array(proposalSchema),
});
export type TripDataset = z.infer<typeof tripDatasetSchema>;
const identity = (r: ContentRef) => key(r.targetKind, r.entityId);
const revisionKey = (r: RevisionRef) => key(r.targetKind, r.entityId, r.revisionId);
const rowRef = (r: ContentRevision): RevisionRef => ({
  tripId: r.tripId,
  targetKind: r.kind,
  entityId: r.entityId,
  revisionId: r.revisionId,
  ...(r.kind === 'asset' ? { hash: r.payload.hash } : {}),
});

function explicitRefs(value: unknown): TargetRef[] {
  if (!value || typeof value !== 'object') {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(explicitRefs);
  }
  const obj = value as Record<string, unknown>;
  if ('tripId' in obj && 'targetKind' in obj && 'entityId' in obj) {
    return [obj as TargetRef];
  }
  return Object.values(obj).flatMap(explicitRefs);
}
/** Stable-ID edges are resolved against a supplied context for historical views. */
function contentEdges(r: ContentRevision): TargetRef[] {
  const refs: TargetRef[] = explicitRefs(r.payload);
  const add = (targetKind: ContentRef['targetKind'], entityId?: string) => {
    if (entityId) {
      refs.push({ tripId: r.tripId, targetKind, entityId });
    }
  };
  const assets = (values: { assetId: string }[]) => values.forEach((a) => add('asset', a.assetId));
  switch (r.kind) {
    case 'region':
      r.payload.guideIds.forEach((i) => add('guide', i));
      assets(r.payload.assetRefs);
      break;
    case 'place':
      r.payload.regionIds.forEach((i) => add('region', i));
      add('guide', r.payload.guideId);
      add('map-target', r.payload.mapTargetId);
      assets(r.payload.assetRefs);
      break;
    case 'guide':
      assets(r.payload.assetRefs);
      r.payload.sections.forEach((s) => {
        s.factRefs.forEach((i) => add('fact', i));
        assets(s.assetRefs);
      });
      break;
    case 'booking':
      add('region', r.payload.regionId);
      add('place', r.payload.placeId);
      break;
  }
  return refs;
}

export function validateTripDataset(raw: unknown): TripDataset {
  const t = tripDatasetSchema.parse(raw),
    tripId = t.header.tripId;
  unique(
    t.contents.map((c) => revisionKey(rowRef(c))),
    'contents',
  );
  unique(t.heads.map(identity), 'heads');
  unique(
    t.plans.map((p) => p.planVersionId),
    'plans',
  );
  unique(
    t.plans.map((p) => String(p.number)),
    'plans.number',
  );
  unique(
    t.records.map((r) => r.recordId),
    'records',
  );
  unique(
    t.proposals.map((p) => key(p.proposalId, p.proposalRevisionId)),
    'proposals',
  );
  unique(
    t.proposals.map((p) => key(p.proposalId, p.proposalRevision)),
    'proposals.number',
  );
  const contents = new Map(t.contents.map((c) => [revisionKey(rowRef(c)), c]));
  const heads = new Map(t.heads.map((h) => [identity(h), h]));
  const plans = new Map(t.plans.map((p) => [p.planVersionId, p]));
  const sameTrip = (value: string, path: string) =>
    ensure(value === tripId, path, '교차 여행 참조를 허용하지 않습니다.', 'BROKEN_REFERENCE');
  const resolve = (ref: RevisionRef, path: string) => {
    sameTrip(ref.tripId, path);
    const found = contents.get(revisionKey(ref));
    ensure(found, path, '고정 revision이 없습니다.', 'BROKEN_REFERENCE');
    if (found.kind === 'asset') {
      ensure(ref.hash === found.payload.hash, path, '첨부 revision과 해시가 다릅니다.', 'BROKEN_REFERENCE');
    }
    return found;
  };
  const target = (ref: TargetRef, path: string) => {
    sameTrip(ref.tripId, path);
    if (ref.targetKind === 'trip') {
      ensure(ref.entityId === tripId && !ref.planVersionId, path, '여행 대상 불일치.', 'BROKEN_REFERENCE');
      return;
    }
    if (ref.targetKind === 'plan') {
      ensure(plans.has(ref.entityId), path, '계획 대상이 없습니다.', 'BROKEN_REFERENCE');
      return;
    }
    if (ref.targetKind === 'day' || ref.targetKind === 'activity') {
      const p = plans.get(ref.planVersionId ?? '');
      ensure(p, path, '일자/활동 대상에는 고정 계획 ID가 필요합니다.', 'BROKEN_REFERENCE');
      ensure(
        ref.targetKind === 'day'
          ? p.days.some((d) => d.dayId === ref.entityId)
          : p.items.some((i) => i.activityId === ref.entityId),
        path,
        '계획 대상이 없습니다.',
        'BROKEN_REFERENCE',
      );
      return;
    }
    ensure(!ref.planVersionId, path, '콘텐츠 참조에 계획 ID를 넣지 않습니다.');
    ensure(heads.has(identity(ref as ContentRef)), path, '콘텐츠 대상이 없습니다.', 'BROKEN_REFERENCE');
    if ('revisionId' in ref) {
      resolve(ref as RevisionRef, path);
    }
  };
  const context = (refs: RevisionRef[], path: string) => {
    unique(refs.map(identity), path);
    refs.forEach((r) => resolve(r, path));
    const pinned = new Map(refs.map((r) => [identity(r), r]));
    for (const ref of refs) {
      for (const edge of contentEdges(resolve(ref, path))) {
        target(edge, path);
        if (['trip', 'plan', 'day', 'activity'].includes(edge.targetKind)) {
          continue;
        }
        ensure(
          pinned.has(identity(edge as ContentRef)),
          path,
          '과거 맥락의 전이 참조 revision이 누락되었습니다.',
          'BROKEN_REFERENCE',
        );
      }
    }
    return (kind: ContentRef['targetKind'], entityId?: string) => {
      if (entityId) {
        ensure(
          pinned.has(key(kind, entityId)),
          path,
          `${kind}/${entityId}의 당시 revision이 필요합니다.`,
          'BROKEN_REFERENCE',
        );
      }
    };
  };
  const content = (kind: ContentRef['targetKind'], entityId: string | undefined, path: string) => {
    if (entityId) {
      target({ tripId, targetKind: kind, entityId }, path);
    }
  };
  const planActivity = (planVersionId: string | undefined, activityId: string, path: string) =>
    target({ tripId, targetKind: 'activity', entityId: activityId, ...(planVersionId ? { planVersionId } : {}) }, path);
  for (const h of t.heads) {
    sameTrip(h.tripId, 'heads');
    ensure(contents.has(revisionKey(h)), 'heads', '현재 revision이 없습니다.', 'BROKEN_REFERENCE');
  }
  const successors: string[] = [];
  for (const c of t.contents) {
    sameTrip(c.tripId, 'contents');
    ensure(heads.has(identity(rowRef(c))), 'contents', '콘텐츠 head가 없습니다.', 'BROKEN_REFERENCE');
    if (c.previousRevisionId) {
      const prev = contents.get(key(c.kind, c.entityId, c.previousRevisionId));
      ensure(prev, 'previousRevisionId', '이전 revision이 없습니다.', 'BROKEN_REFERENCE');
      ensure(prev.commitSeq < c.commitSeq, 'previousRevisionId', 'revision은 이전 저장보다 뒤여야 합니다.');
      successors.push(key(c.kind, c.entityId, c.previousRevisionId));
    }
    contentEdges(c).forEach((ref) => target(ref, 'contents.refs'));
    if (c.kind === 'guide') {
      const p = c.payload;
      unique(
        p.sections.map((s) => s.key),
        'sections.key',
      );
      unique(
        p.sections.map((s) => String(s.order)),
        'sections.order',
      );
      unique(
        p.factBindings.map((b) => b.token),
        'factBindings',
      );
      if (p.documentKind === 'place-guide') {
        ensure(
          ['why_go', 'deep', 'practical'].every((k) => p.sections.some((s) => s.key === k)),
          'sections',
          '장소 본문의 세 섹션이 필요합니다.',
        );
      }
      const bindings = new Map(p.factBindings.map((b) => [b.token, b.ref]));
      p.sections.forEach((s) => {
        const tokens = [...s.bodyMd.matchAll(/\{\{fact:([^{}]+)\}\}/g)];
        ensure(
          !s.bodyMd.replace(/\{\{fact:[^{}]+\}\}/g, '').includes('{{fact:'),
          'bodyMd',
          '깨진 fact 토큰입니다.',
          'BROKEN_REFERENCE',
        );
        for (const token of tokens) {
          const ref = bindings.get(token[1]);
          ensure(
            ref && s.factRefs.includes(ref.entityId),
            'bodyMd',
            'fact 토큰 바인딩이 없습니다.',
            'BROKEN_REFERENCE',
          );
        }
        for (const [uri] of s.bodyMd.matchAll(/travel:\/\/[^\s)<>"']*/g)) {
          const parsed = /^travel:\/\/([a-z-]+)\/([A-Za-z0-9][A-Za-z0-9._:-]*)$/.exec(uri);
          ensure(
            parsed && s.linkRefs.some((r) => r.targetKind === parsed[1] && r.entityId === parsed[2]),
            'bodyMd',
            '내부 링크 바인딩이 없거나 URI가 잘못되었습니다.',
            'BROKEN_REFERENCE',
          );
        }
        for (const [uri] of s.bodyMd.matchAll(/asset:\/\/[^\s)<>"']*/g)) {
          const parsed = /^asset:\/\/([A-Za-z0-9][A-Za-z0-9._:-]*)$/.exec(uri);
          ensure(
            parsed && s.assetRefs.some((r) => r.assetId === parsed[1]),
            'bodyMd',
            '본문 첨부 바인딩이 없거나 URI가 잘못되었습니다.',
            'BROKEN_REFERENCE',
          );
        }
      });
      if (p.documentKind === 'transit') {
        p.structuredData.itineraryUses.forEach((u) =>
          u.dayIds.forEach((d) =>
            target({ tripId, targetKind: 'day', entityId: d, planVersionId: u.planVersionId }, 'transit.itineraryUses'),
          ),
        );
      }
    }
    if (c.kind === 'booking') {
      c.payload.activityIds.forEach((a) => planActivity(c.payload.planVersionId, a, 'booking.activityIds'));
    }
    if (c.kind === 'fact') {
      ensure(
        !c.payload.appliesFrom || !c.payload.appliesTo || c.payload.appliesFrom <= c.payload.appliesTo,
        'fact.appliesTo',
        '사실 적용 기간이 역순입니다.',
      );
    }
    if (c.kind === 'map-target' && c.payload.mapKind === 'place') {
      ensure(
        (c.payload.lat === undefined) === (c.payload.lng === undefined),
        'map-target',
        '위도·경도 쌍이 필요합니다.',
      );
    }
    if (c.kind === 'phrase-book') {
      const p = c.payload;
      unique(p.categories, 'phrase.categories');
      unique(
        p.phrases.map((f) => f.id),
        'phrases',
      );
      p.phrases.forEach((f) => {
        ensure(p.categories.includes(f.category), 'phrase.category', '회화 분류가 없습니다.');
        f.dayIds.forEach((d) =>
          target(
            { tripId, targetKind: 'day', entityId: d, ...(f.planVersionId ? { planVersionId: f.planVersionId } : {}) },
            'phrase.dayIds',
          ),
        );
      });
      p.contextRecommendations.forEach((r) => {
        r.phraseIds.forEach((i) =>
          ensure(
            p.phrases.some((f) => f.id === i),
            'phrase.recommendations',
            '추천 회화가 없습니다.',
            'BROKEN_REFERENCE',
          ),
        );
        r.dayIds.forEach((d) =>
          target(
            { tripId, targetKind: 'day', entityId: d, ...(r.planVersionId ? { planVersionId: r.planVersionId } : {}) },
            'phrase.dayIds',
          ),
        );
      });
    }
  }
  unique(successors, 'content.previousRevisionId');
  for (const h of t.heads) {
    const versions = t.contents.filter((c) => c.kind === h.targetKind && c.entityId === h.entityId);
    ensure(
      versions.filter((c) => !c.previousRevisionId).length === 1,
      'contents',
      '콘텐츠는 하나의 초기 revision에서 이어져야 합니다.',
    );
    ensure(
      !versions.some((c) => c.previousRevisionId === h.revisionId),
      'heads',
      '현재 head는 마지막 revision이어야 합니다.',
    );
  }
  const planContext = (p: PlanVersion) => {
    const pin = context(p.contextRefs, 'plan.contextRefs');
    sameTrip(p.tripId, 'plans');
    unique(
      p.days.map((d) => d.dayId),
      'days',
    );
    unique(
      p.days.map((d) => String(d.ordinal)),
      'days.ordinal',
    );
    unique(
      p.items.map((i) => i.activityId),
      'items',
    );
    unique(
      p.items.map((i) => key(i.dayId, i.order)),
      'items.order',
    );
    unique(
      p.legs.map((l) => l.legId),
      'legs',
    );
    unique(
      p.stays.map((s) => s.stayId),
      'stays',
    );
    ensure(Boolean(p.parentId) === p.number > 1, 'plans.parentId', '첫 계획부터 부모 연결을 보존해야 합니다.');
    if (p.parentId) {
      const parent = plans.get(p.parentId);
      ensure(
        parent && parent.number + 1 === p.number && parent.commitSeq < p.commitSeq,
        'plans.parentId',
        '이전 계획이 없거나 순서가 잘못되었습니다.',
        'BROKEN_REFERENCE',
      );
    }
    const own = (r: { tripId: string; planVersionId: string }) => {
      sameTrip(r.tripId, 'plan.children');
      ensure(r.planVersionId === p.planVersionId, 'plan.children', '다른 계획의 자식입니다.');
    };
    for (const d of p.days) {
      own(d);
      ensure(d.date >= t.header.startDate && d.date <= t.header.endDate, 'day.date', '여행 날짜 범위 밖입니다.');
      d.regionIds.forEach((i) => pin('region', i));
      pin('region', d.overnightRegionId);
      d.assetRefs.forEach((a) => pin('asset', a.assetId));
    }
    for (const i of p.items) {
      own(i);
      ensure(
        p.days.some((d) => d.dayId === i.dayId),
        'item.dayId',
        '일자가 없습니다.',
        'BROKEN_REFERENCE',
      );
      i.placeLinks.forEach((l) => pin('place', l.placeId));
      i.bookingIds.forEach((b) => pin('booking', b));
      pin('map-target', i.mapTargetId);
      i.taskRefs.forEach((r) => {
        resolve(r, 'item.taskRefs');
        pin('task', r.entityId);
        ensure(
          p.contextRefs.some((c) => revisionKey(c) === revisionKey(r)),
          'item.taskRefs',
          '계획 맥락과 작업 revision이 다릅니다.',
          'BROKEN_REFERENCE',
        );
      });
    }
    for (const l of p.legs) {
      own(l);
      ensure(
        p.days.some((d) => d.dayId === l.dayId) &&
          [l.fromActivityId, l.toActivityId].every((a) =>
            p.items.some((i) => i.activityId === a && i.dayId === l.dayId),
          ),
        'leg',
        '같은 날짜의 출발·도착 활동이 필요합니다.',
        'BROKEN_REFERENCE',
      );
      pin('asset', l.geometryAssetId);
      pin('map-target', l.mapTargetId);
    }
    for (const s of p.stays) {
      own(s);
      pin('region', s.regionId);
      pin('booking', s.bookingId);
    }
  };
  t.plans.forEach(planContext);
  ensure(plans.has(t.header.currentPlanVersionId), 'currentPlanVersionId', '현재 계획이 없습니다.', 'BROKEN_REFERENCE');
  const recordMap = new Map(t.records.map((r) => [r.recordId, r]));
  const corrected: string[] = [];
  for (const r of t.records) {
    sameTrip(r.tripId, 'records');
    explicitRefs(r.payload).forEach((ref) => target(ref, 'records.refs'));
    if (r.kind !== 'legacy-state') {
      const pin = context(r.payload.contextRefs, 'record.contextRefs');
      if (r.kind === 'actual') {
        if (r.payload.activityId) {
          planActivity(r.payload.planVersionId, r.payload.activityId, 'actual.activityId');
          const item = plans.get(r.payload.planVersionId!)!.items.find((i) => i.activityId === r.payload.activityId)!;
          item.placeLinks.forEach((l) => pin('place', l.placeId));
          item.bookingIds.forEach((b) => pin('booking', b));
          item.taskRefs.forEach((t) => pin('task', t.entityId));
          pin('map-target', item.mapTargetId);
        } else if (r.payload.planVersionId) {
          ensure(plans.has(r.payload.planVersionId), 'actual.planVersionId', '계획이 없습니다.', 'BROKEN_REFERENCE');
        }
        pin('place', r.payload.placeRef?.entityId);
      }
      if (r.kind === 'note' && !['trip', 'plan', 'day', 'activity'].includes(r.payload.targetRef.targetKind)) {
        pin(r.payload.targetRef.targetKind as ContentRef['targetKind'], r.payload.targetRef.entityId);
      }
      if (r.kind === 'task-state') {
        const task = resolve(r.payload.taskRef, 'task-state');
        ensure(
          task.kind === 'task' && task.payload.meaningFingerprint === r.payload.meaningFingerprint,
          'task-state.meaningFingerprint',
          '다른 의미의 완료를 승계할 수 없습니다.',
        );
        pin('task', r.payload.taskRef.entityId);
        ensure(
          r.payload.contextRefs.some((c) => revisionKey(c) === revisionKey(r.payload.taskRef)),
          'task-state.contextRefs',
          '작업과 맥락 revision이 다릅니다.',
          'BROKEN_REFERENCE',
        );
      }
    }
    if (r.supersedes) {
      const prev = recordMap.get(r.supersedes);
      ensure(
        prev && prev.kind === r.kind && prev.commitSeq < r.commitSeq,
        'supersedes',
        '같은 kind의 이전 기록만 정정합니다.',
        'BROKEN_REFERENCE',
      );
      corrected.push(r.supersedes);
    }
  }
  unique(corrected, 'records.supersedes');
  const proposalParents: string[] = [];
  for (const p of t.proposals) {
    sameTrip(p.tripId, 'proposals');
    ensure(plans.has(p.basePlanVersionId), 'proposal.basePlanVersionId', '기준 계획이 없습니다.', 'BROKEN_REFERENCE');
    ensure(p.baseDomainRevision <= t.header.domainRevision, 'proposal.baseDomainRevision', '미래 revision입니다.');
    p.evidenceRefs.forEach((r) => resolve(r, 'proposal.evidenceRefs'));
    unique(
      p.operations.map((o) => (o.type === 'upsert-item' ? o.item.activityId : o.activityId)),
      'proposal.operations',
    );
    for (const o of p.operations) {
      if (o.type === 'upsert-item') {
        sameTrip(o.item.tripId, 'proposal.item');
        ensure(o.item.planVersionId === p.basePlanVersionId, 'proposal.item', '기준 계획이 다릅니다.');
        target(
          { tripId, targetKind: 'day', entityId: o.item.dayId, planVersionId: p.basePlanVersionId },
          'proposal.day',
        );
        o.item.placeLinks.forEach((l) => content('place', l.placeId, 'proposal.place'));
        o.item.bookingIds.forEach((b) => content('booking', b, 'proposal.booking'));
        content('map-target', o.item.mapTargetId, 'proposal.map');
        o.item.taskRefs.forEach((r) => resolve(r, 'proposal.task'));
      } else {
        planActivity(p.basePlanVersionId, o.activityId, 'proposal.remove');
      }
    }
    ensure(
      Boolean(p.previousProposalRevisionId) === p.proposalRevision > 1,
      'proposal.previous',
      '초안 revision 연결이 필요합니다.',
    );
    if (p.previousProposalRevisionId) {
      ensure(
        t.proposals.some(
          (prev) =>
            prev.proposalId === p.proposalId &&
            prev.proposalRevisionId === p.previousProposalRevisionId &&
            prev.proposalRevision < p.proposalRevision &&
            prev.commitSeq < p.commitSeq,
        ),
        'proposal.previous',
        '이전 초안 revision이 없습니다.',
        'BROKEN_REFERENCE',
      );
    }
    if (p.previousProposalRevisionId) {
      proposalParents.push(key(p.proposalId, p.previousProposalRevisionId));
    }
    if (p.resultPlanVersionId) {
      ensure(
        plans.get(p.resultPlanVersionId)?.proposalId === p.proposalId,
        'proposal.result',
        '결과 계획의 변경안 연결이 없습니다.',
        'BROKEN_REFERENCE',
      );
    }
  }
  unique(proposalParents, 'proposal.previous');
  for (const p of t.plans) {
    if (p.proposalId) {
      ensure(
        t.proposals.some(
          (r) => r.proposalId === p.proposalId && r.status === 'applied' && r.resultPlanVersionId === p.planVersionId,
        ),
        'plan.proposalId',
        '적용한 변경안이 없습니다.',
        'BROKEN_REFERENCE',
      );
    }
  }
  return t;
}

/** Pure candidate check; does not provide transactions or a persistence path. */
export function validateImmutableTransition(beforeRaw: unknown, afterRaw: unknown): TripDataset {
  const before = validateTripDataset(beforeRaw),
    after = validateTripDataset(afterRaw);
  ensure(before.header.tripId === after.header.tripId, 'header.tripId', '여행 ID를 바꿀 수 없습니다.');
  const preserve = <T>(oldRows: T[], newRows: T[], getKey: (row: T) => string, path: string) => {
    const rows = new Map(newRows.map((row) => [getKey(row), canonicalJson(row)]));
    oldRows.forEach((row) =>
      ensure(rows.get(getKey(row)) === canonicalJson(row), path, '기존 불변 행을 변경하거나 제거할 수 없습니다.'),
    );
  };
  preserve(before.contents, after.contents, (c) => revisionKey(rowRef(c)), 'contents');
  preserve(before.plans, after.plans, (p) => p.planVersionId, 'plans');
  preserve(before.records, after.records, (r) => r.recordId, 'records');
  preserve(before.proposals, after.proposals, (p) => key(p.proposalId, p.proposalRevisionId), 'proposals');
  return after;
}
