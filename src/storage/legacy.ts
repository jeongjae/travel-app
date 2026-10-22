import { Temporal } from '@js-temporal/polyfill';
import { validateTrip, type Trip } from '../domain';
import {
  canonicalJson,
  id,
  validateTripDataset,
  type ContentRevision,
  type PlanVersion,
  type TimeSpec,
  type TripDataset,
  type Proposal,
} from '../contracts/v2/index';

// Prototype IndexedDB rows may contain explicitly undefined optional fields.
// Tag every node so undefined, missing keys, arrays and user objects cannot collide.
export function legacyCanonical(value: unknown): string {
  const tag = (v: unknown): unknown =>
    v === undefined
      ? ['undefined']
      : v === null
        ? ['null']
        : Array.isArray(v)
          ? ['array', Array.from(v, tag)]
          : typeof v === 'object'
            ? [
                'object',
                Object.keys(v)
                  .sort()
                  .map((k) => [k, tag((v as Record<string, unknown>)[k])]),
              ]
            : [typeof v, v];
  return canonicalJson(tag(value));
}

export const legacyId = (value: string) =>
  id.safeParse(value).success
    ? value
    : `legacy-${[...new TextEncoder().encode(value)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
export function legacyTime(value: string, zone: string): TimeSpec {
  const z = Temporal.Instant.from(value).toZonedDateTimeISO(zone);
  return {
    precision: 'instant',
    date: z.toPlainDate().toString(),
    localTime: z.toPlainTime().toString(),
    timeZone: zone,
    offset: z.offset,
    instant: value,
  };
}
export function convertLegacy(raw: unknown): { dataset: TripDataset; warnings: string[] } {
  const old = validateTrip(raw),
    tripId = legacyId(old.id),
    contents: ContentRevision[] = [],
    warnings = ['v1 전체 원문·영수증은 보존합니다. v1 영수증은 정확한 v2 replay 대신 동일 ID 쓰기를 차단합니다.'];
  let seq = 1;
  const src = (key: string) => [
    { sourceKind: 'prototype-v1', sourceKey: key, locator: key, sourcePath: 'IndexedDB/trips' },
  ];
  old.places.forEach((p) =>
    contents.push({
      tripId,
      entityId: legacyId(p.id),
      kind: 'place',
      revisionId: 'legacy-1',
      schemaVersion: 2,
      sourceRefs: src(p.id),
      recordedAt: old.versions[0].createdAt,
      actor: 'import',
      commitSeq: seq,
      payload: {
        regionIds: [],
        name: p.name,
        aliases: [],
        placeKind: 'unspecified',
        summary: '',
        dontMiss: [],
        assetRefs: [],
      },
    }),
  );
  const heads = () =>
    contents.map((c) => ({
      tripId,
      targetKind: c.kind,
      entityId: c.entityId,
      revisionId: c.revisionId,
      status: 'active' as const,
    }));
  const context = () =>
    contents.map((c) => ({ tripId, targetKind: c.kind, entityId: c.entityId, revisionId: c.revisionId }));
  const item = (
    a: Trip['versions'][number]['activities'][number],
    planVersionId: string,
    order: number,
  ): PlanVersion['items'][number] => ({
    tripId,
    planVersionId,
    activityId: legacyId(a.id),
    dayId: `day-${legacyTime(a.start, a.timeZone).date}`,
    order,
    title: a.title,
    category: 'legacy',
    time: { start: legacyTime(a.start, a.timeZone), end: legacyTime(a.end, a.timeZone) },
    summary: a.note,
    optional: false,
    placeLinks: a.placeId ? [{ placeId: legacyId(a.placeId), relation: 'visit' }] : [],
    bookingIds: [],
    taskRefs: [],
    executionMarkers: [],
    sourceFlags: [],
  });
  const plans: PlanVersion[] = old.versions.map((v) => {
    const planVersionId = `legacy-plan-${v.number}`;
    const dates: string[] = [];
    for (let d = Temporal.PlainDate.from(old.startDate); d.toString() <= old.endDate; d = d.add({ days: 1 }))
      dates.push(d.toString());
    // Preserve per-version evidence as separate immutable identities.
    v.evidence.forEach((e) =>
      contents.push({
        tripId,
        entityId: `e-${v.number}-${legacyId(e.id)}`,
        kind: 'evidence',
        revisionId: 'legacy-1',
        schemaVersion: 2,
        sourceRefs: src(e.id),
        recordedAt: e.checkedAt,
        actor: 'import',
        commitSeq: 1,
        payload: {
          sourceType: /^https?:/.test(e.source) ? 'web' : 'local',
          sourceUrlOrRef: e.source,
          claim: e.claim,
          ...(e.status === 'verified'
            ? { sourceVerifiedAt: legacyTime(e.checkedAt, 'UTC') }
            : { collectedAt: e.checkedAt }),
          relatedRefs: [],
        },
      }),
    );
    return {
      tripId,
      planVersionId,
      number: v.number,
      ...(v.number > 1 ? { parentId: `legacy-plan-${v.number - 1}` } : {}),
      reason: v.reason,
      createdAt: v.createdAt,
      commitSeq: ++seq,
      contextRefs: context(),
      ...(v.proposalId ? { proposalId: legacyId(v.proposalId) } : {}),
      days: dates.map((date, n) => ({
        tripId,
        planVersionId,
        dayId: `day-${date}`,
        ordinal: n + 1,
        date,
        cityText: '',
        title: date,
        regionIds: [],
        time: { start: { precision: 'date', date } },
        transport: [],
        food: [],
        highlights: [],
        needsReview: [],
        assetRefs: [],
      })),
      items: v.activities.map((a, n) => item(a, planVersionId, n)),
      legs: [],
      stays: [],
    };
  });
  const records: TripDataset['records'] = old.actuals.map((a) => {
    if (a.activityId)
      warnings.push(
        `actual ${legacyId(a.id)}: v1에 당시 계획 ID가 없어 연결은 원문 보고서에 보존하고 고정 계획을 추정하지 않음.`,
      );
    return {
      tripId,
      recordId: legacyId(a.id),
      kind: 'actual',
      recordedAt: a.createdAt,
      commitSeq: ++seq,
      sourceRefs: src(a.id),
      ...(a.supersedes ? { supersedes: legacyId(a.supersedes) } : {}),
      payload: {
        title: a.title,
        targetSummary: a.title,
        outcome: a.outcome,
        time: { start: legacyTime(a.start, a.timeZone), end: legacyTime(a.end, a.timeZone) },
        note: a.note,
        ...(a.placeId ? { placeRef: { tripId, targetKind: 'place', entityId: legacyId(a.placeId) } } : {}),
        contextRefs: context(),
      },
    };
  });
  const proposals: Proposal[] = [];
  for (const p of old.proposals) {
    if (p.status !== 'pending' && (!p.decidedAt || p.decidedBy !== 'user'))
      throw new Error('기존 결정의 사용자·시각을 확인할 수 없어 전환하지 않았습니다. v1 원문을 보존했습니다.');
    p.evidence.forEach((e) =>
      contents.push({
        tripId,
        entityId: `p-${legacyId(p.id)}-${legacyId(e.id)}`,
        kind: 'evidence',
        revisionId: 'legacy-1',
        schemaVersion: 2,
        sourceRefs: src(e.id),
        recordedAt: e.checkedAt,
        actor: 'import',
        commitSeq: 1,
        payload: {
          sourceType: /^https?:/.test(e.source) ? 'web' : 'local',
          sourceUrlOrRef: e.source,
          claim: e.claim,
          ...(e.status === 'verified'
            ? { sourceVerifiedAt: legacyTime(e.checkedAt, 'UTC') }
            : { collectedAt: e.checkedAt }),
          relatedRefs: [],
        },
      }),
    );
    const base = plans.find((v) => v.number === p.basePlanNumber)!;
    const proposal: Proposal = {
      tripId,
      proposalId: legacyId(p.id),
      proposalRevisionId: `${legacyId(p.id)}-pending`,
      proposalRevision: 1,
      baseDomainRevision: p.baseRevision,
      basePlanVersionId: base.planVersionId,
      origin: 'ai',
      operations: p.operations.map((o) =>
        o.type === 'remove'
          ? { type: 'remove-item', activityId: legacyId(o.activityId) }
          : {
              type: 'upsert-item',
              item: item(
                o.activity,
                base.planVersionId,
                base.items.find((i) => i.activityId === legacyId(o.activity.id))?.order ?? base.items.length,
              ),
            },
      ),
      reason: p.reason,
      evidenceRefs: p.evidence.map((e) => ({
        tripId,
        targetKind: 'evidence',
        entityId: `p-${legacyId(p.id)}-${legacyId(e.id)}`,
        revisionId: 'legacy-1',
      })),
      impact: { activityIds: [], reservationText: p.reservationImpact },
      status: 'pending',
      commitSeq: ++seq,
    };
    proposals.push(proposal);
    if (p.status !== 'pending')
      proposals.push({
        ...proposal,
        proposalRevision: 2,
        proposalRevisionId: `${legacyId(p.id)}-decision`,
        previousProposalRevisionId: proposal.proposalRevisionId,
        status: p.status,
        decision: {
          action: p.status === 'applied' ? 'apply' : 'reject',
          actor: 'user',
          decidedAt: p.decidedAt ?? p.createdAt,
        },
        ...(p.status === 'applied'
          ? { resultPlanVersionId: plans.find((v) => v.proposalId === legacyId(p.id))!.planVersionId }
          : {}),
        commitSeq: ++seq,
      });
  }
  return {
    dataset: validateTripDataset({
      domainSchemaVersion: 2,
      header: {
        tripId,
        name: old.name,
        startDate: old.startDate,
        endDate: old.endDate,
        defaultTimeZone: old.timeZone,
        timeZoneStatus: 'confirmed',
        domainRevision: old.revision,
        currentPlanVersionId: plans.at(-1)!.planVersionId,
      },
      heads: heads(),
      contents,
      plans,
      records,
      proposals,
    }),
    warnings,
  };
}
