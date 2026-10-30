import { afterEach, describe, expect, it } from 'vitest';
import { ContentRepository, TravelDB } from '../src/repository';
import { buildNewTrip } from '../src/content/trip-factory';
import { actualPayload, contextWithPlace, correctionLinks, type ActualRecord } from '../src/content/field-rules';
import type { ContentRevision, FieldRecord, RevisionRef, TimeSpec, TripDataset } from '../src/contracts/v2/index';

/** C-04 T-C5: 실제 기록의 장소 연결, 추가식 정정과 당시 맥락 보존. 가상 여행만 사용한다. */
const databases: TravelDB[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close();
    await database.delete();
  }
});

const uuid = () => crypto.randomUUID();
const envelope = (
  tripId: string,
  kind: string,
  payload: unknown,
  expectedDomainRevision?: number,
  requestId = uuid(),
) => ({
  format: 'travel-app-command',
  commandVersion: 2,
  normalizationVersion: 'c04',
  tripId,
  requestId,
  kind,
  payload,
  ...(expectedDomainRevision === undefined ? {} : { expectedDomainRevision }),
});
async function setup() {
  const db = new TravelDB(`field-${uuid()}`);
  databases.push(db);
  const repo = new ContentRepository(db);
  await repo.init();
  return { db, repo };
}
const head = (trip: TripDataset, kind: string, entityId: string) =>
  trip.heads.find((h) => h.targetKind === kind && h.entityId === entityId)!;
const content = (trip: TripDataset, kind: string, entityId: string) =>
  trip.contents.find(
    (c) => c.kind === kind && c.entityId === entityId && c.revisionId === head(trip, kind, entityId).revisionId,
  )!;
const base = (tripId: string) => ({ tripId, schemaVersion: 2, sourceRefs: [] });

async function newTrip(repo: ContentRepository, name = '가상 여행') {
  const trip = buildNewTrip({ name, start: '2032-05-01', end: '2032-05-03' });
  await repo.execute(envelope(trip.tripId, 'CreateTrip', { header: trip.header, initialPlan: trip.initialPlan }));
  return trip.tripId;
}
async function addPlace(repo: ContentRepository, tripId: string, name: string) {
  const regionId = uuid();
  const placeId = uuid();
  const revision = (await repo.get(tripId)).header.domainRevision;
  await repo.execute(
    envelope(
      tripId,
      'CreateContentBatch',
      {
        create: [
          {
            ...base(tripId),
            kind: 'region',
            entityId: regionId,
            revisionId: uuid(),
            payload: { name: '가상 지역', guideIds: [], assetRefs: [] },
          },
          {
            ...base(tripId),
            kind: 'place',
            entityId: placeId,
            revisionId: uuid(),
            payload: {
              regionIds: [regionId],
              name,
              aliases: [],
              placeKind: 'sight',
              summary: '당시 요약',
              dontMiss: [],
              assetRefs: [],
            },
          },
        ],
        updateOwners: [],
      },
      revision,
    ),
  );
  return placeId;
}
const local = (date: string, localTime: string): TimeSpec => ({
  precision: 'local',
  date,
  localTime,
  timeZoneStatus: 'unknown',
});
const edits = (tripId: string, extra: Partial<Parameters<typeof actualPayload>[1]> = {}) => ({
  title: '가상 기록',
  outcome: 'unplanned' as const,
  note: '메모',
  start: local('2032-05-01', '10:00'),
  placeId: '',
  tripId,
  ...extra,
});
const actualRecord = (tripId: string, payload: ActualRecord['payload'], extra: Record<string, unknown> = {}) => ({
  tripId,
  recordId: uuid(),
  kind: 'actual',
  sourceRefs: [] as unknown[],
  payload,
  ...extra,
});
async function record(repo: ContentRepository, tripId: string, row: ReturnType<typeof actualRecord>) {
  const trip = await repo.get(tripId);
  return repo.execute(envelope(tripId, 'RecordActual', { record: row }, trip.header.domainRevision));
}
async function correct(
  repo: ContentRepository,
  tripId: string,
  original: FieldRecord,
  payload: ActualRecord['payload'],
  revision?: number,
) {
  const trip = await repo.get(tripId);
  const row = actualRecord(tripId, payload, { supersedes: original.recordId, sourceRefs: original.sourceRefs });
  return repo.execute(
    envelope(
      tripId,
      'CorrectActual',
      { supersedes: original.recordId, record: row },
      revision ?? trip.header.domainRevision,
    ),
  );
}
const actuals = async (repo: ContentRepository, tripId: string) =>
  (await repo.timeline(tripId))
    .filter((r): r is ActualRecord => r.kind === 'actual')
    .toSorted((a, b) => a.commitSeq - b.commitSeq);
const snapshot = async (db: TravelDB, repo: ContentRepository, tripId: string) => ({
  trip: await repo.get(tripId),
  receipts: await db.table('command_receipts').count(),
});

describe('예정 외 활동의 장소 연결', () => {
  it('장소를 고른 기록과 장소 없는 기록을 저장하고 계획은 바꾸지 않는다', async () => {
    const { repo } = await setup();
    const tripId = await newTrip(repo);
    const placeId = await addPlace(repo, tripId, '가상 장소');
    const before = await repo.get(tripId);
    const context = await repo.currentContext(tripId);
    await record(
      repo,
      tripId,
      actualRecord(tripId, actualPayload(undefined, edits(tripId, { placeId }), context, context)),
    );
    await record(
      repo,
      tripId,
      actualRecord(tripId, actualPayload(undefined, edits(tripId, { title: '장소 없음' }), context, context)),
    );
    const after = await repo.get(tripId);
    const [withPlace, withoutPlace] = await actuals(repo, tripId);
    expect(withPlace.payload.placeRef).toEqual({ tripId, targetKind: 'place', entityId: placeId });
    const pinned = withPlace.payload.contextRefs.find((ref) => ref.targetKind === 'place' && ref.entityId === placeId);
    expect(pinned?.revisionId).toBe(head(after, 'place', placeId).revisionId);
    expect(withoutPlace.payload.placeRef).toBeUndefined();
    // 현장 기록은 계획을 만들거나 바꾸지 않고, 계획 항목도 자동으로 만들지 않는다.
    expect(after.plans).toEqual(before.plans);
    expect(after.header.currentPlanVersionId).toBe(before.header.currentPlanVersionId);
    expect(after.plans.every((plan) => plan.items.length === 0)).toBe(true);
  });

  it('없는·비활성·다른 여행 장소와 현재 revision이 아닌 맥락을 거부하고 상태를 바꾸지 않는다', async () => {
    const { db, repo } = await setup();
    const tripId = await newTrip(repo);
    const otherTripId = await newTrip(repo, '다른 여행');
    const placeId = await addPlace(repo, tripId, '가상 장소');
    const otherPlaceId = await addPlace(repo, otherTripId, '다른 여행 장소');
    const inactiveId = await addPlace(repo, tripId, '곧 비활성');
    const target = head(await repo.get(tripId), 'place', inactiveId);
    await repo.execute(
      envelope(
        tripId,
        'DeactivateContent',
        { target: { targetKind: 'place', entityId: inactiveId, revisionId: target.revisionId } },
        (await repo.get(tripId)).header.domainRevision,
      ),
    );
    const fresh = await repo.currentContext(tripId);
    const before = await snapshot(db, repo, tripId);
    const attempt = (placeRef: unknown, ctx = fresh) =>
      record(
        repo,
        tripId,
        actualRecord(tripId, {
          ...actualPayload(undefined, edits(tripId), ctx, ctx),
          placeRef,
        } as ActualRecord['payload']),
      );
    await expect(attempt({ tripId, targetKind: 'place', entityId: uuid() })).rejects.toThrow();
    await expect(attempt({ tripId, targetKind: 'place', entityId: inactiveId })).rejects.toThrow('BROKEN_REFERENCE');
    await expect(attempt({ tripId: otherTripId, targetKind: 'place', entityId: otherPlaceId })).rejects.toThrow(
      'BROKEN_REFERENCE',
    );
    // 맥락이 장소의 현재 revision을 고정하지 않으면 거부한다.
    const staleContext = fresh.map((ref) => (ref.entityId === placeId ? { ...ref, revisionId: uuid() } : ref));
    await expect(attempt({ tripId, targetKind: 'place', entityId: placeId }, staleContext)).rejects.toThrow();
    expect(await snapshot(db, repo, tripId)).toEqual(before);
  });

  it('두 여행의 기록은 서로 보이지 않는다', async () => {
    const { repo } = await setup();
    const a = await newTrip(repo, 'A');
    const b = await newTrip(repo, 'B');
    const placeId = await addPlace(repo, a, 'A 장소');
    const context = await repo.currentContext(a);
    await record(repo, a, actualRecord(a, actualPayload(undefined, edits(a, { placeId }), context, context)));
    expect(await actuals(repo, b)).toHaveLength(0);
    expect(await actuals(repo, a)).toHaveLength(1);
  });

  it('같은 요청을 다시 보내면 기록이 하나만 남는다(replay)', async () => {
    const { repo } = await setup();
    const tripId = await newTrip(repo);
    const context = await repo.currentContext(tripId);
    const row = actualRecord(tripId, actualPayload(undefined, edits(tripId), context, context));
    const requestId = uuid();
    const revision = (await repo.get(tripId)).header.domainRevision;
    await repo.execute(envelope(tripId, 'RecordActual', { record: row }, revision, requestId));
    await repo.execute(envelope(tripId, 'RecordActual', { record: row }, revision, requestId));
    expect(await actuals(repo, tripId)).toHaveLength(1);
  });
});

describe('추가식 정정', () => {
  async function withRecord() {
    const ctx = await setup();
    const tripId = await newTrip(ctx.repo);
    const placeId = await addPlace(ctx.repo, tripId, '가상 장소');
    const context = await ctx.repo.currentContext(tripId);
    const exact: TimeSpec = {
      precision: 'instant',
      date: '2032-05-01',
      localTime: '10:00',
      timeZone: 'Asia/Seoul',
      offset: '+09:00',
      instant: '2032-05-01T01:00:00Z',
    };
    const endTime: TimeSpec = { ...exact, localTime: '11:30', instant: '2032-05-01T02:30:00Z' };
    const payload: ActualRecord['payload'] = {
      title: '가상 기록',
      targetSummary: '원래 요약',
      outcome: 'unplanned',
      time: { start: exact, end: endTime },
      note: '처음 메모',
      placeRef: { tripId, targetKind: 'place', entityId: placeId },
      contextRefs: context,
    };
    const sourceRefs = [{ sourceKind: 'note', sourceKey: 'k', locator: 'l', sourcePath: 'p' }];
    await record(ctx.repo, tripId, actualRecord(tripId, payload, { sourceRefs }));
    const [original] = await actuals(ctx.repo, tripId);
    return { ...ctx, tripId, placeId, original, context };
  }
  /** 폼에서 메모만 바꾼 입력. 나머지는 원본 값을 그대로 둔다. */
  const memoOnly = (tripId: string, record: ActualRecord, note: string, current: RevisionRef[]) =>
    actualPayload(
      record,
      { ...edits(tripId, { placeId: record.payload.placeRef!.entityId }), note, start: record.payload.time.start },
      record.payload.contextRefs,
      current,
    );

  it('메모만 정정하면 종료 시각·정밀도·오프셋·instant·원천·장소·맥락을 그대로 보존한다', async () => {
    const { repo, tripId, original, context } = await withRecord();
    await correct(repo, tripId, original, memoOnly(tripId, original, '정정한 메모', context));
    const rows = await actuals(repo, tripId);
    expect(rows).toHaveLength(2);
    const [kept, fixed] = rows;
    expect(kept).toEqual(original);
    expect(fixed.supersedes).toBe(original.recordId);
    expect(fixed.payload.note).toBe('정정한 메모');
    expect(fixed.payload.time).toEqual(original.payload.time);
    expect(fixed.payload.placeRef).toEqual(original.payload.placeRef);
    expect(fixed.payload.contextRefs).toEqual(original.payload.contextRefs);
    expect(fixed.payload.targetSummary).toBe('원래 요약');
    expect(fixed.sourceRefs).toEqual(original.sourceRefs);
  });

  it('정정을 두 번 이어도 연결이 유지되고 이미 정정된 원문의 재정정은 거부한다', async () => {
    const { db, repo, tripId, original, context } = await withRecord();
    await correct(repo, tripId, original, memoOnly(tripId, original, '둘째', context));
    const second = (await actuals(repo, tripId))[1];
    await correct(repo, tripId, second, memoOnly(tripId, second, '셋째', context));
    const rows = await actuals(repo, tripId);
    const links = correctionLinks(rows);
    expect(rows.map((r) => links.get(r.recordId)!.position)).toEqual([1, 2, 3]);
    expect(links.get(rows[2].recordId)!.after).toBeUndefined();
    expect(links.get(rows[0].recordId)!.length).toBe(3);
    const before = await snapshot(db, repo, tripId);
    await expect(correct(repo, tripId, original, memoOnly(tripId, original, '분기', context))).rejects.toThrow(
      'CONFLICT',
    );
    expect(await snapshot(db, repo, tripId)).toEqual(before);
  });

  it('다른 탭이 먼저 기록하면 오래된 기준의 정정을 거부하고 상태를 바꾸지 않는다', async () => {
    const { db, repo, tripId, original, context } = await withRecord();
    const stale = (await repo.get(tripId)).header.domainRevision;
    await record(
      repo,
      tripId,
      actualRecord(tripId, actualPayload(undefined, edits(tripId, { title: '다른 탭' }), context, context)),
    );
    const before = await snapshot(db, repo, tripId);
    await expect(
      correct(repo, tripId, original, memoOnly(tripId, original, '오래된 폼', context), stale),
    ).rejects.toThrow('CONFLICT');
    expect(await snapshot(db, repo, tripId)).toEqual(before);
  });

  it('정정이 원본의 원천 정보를 지우거나 계획 연결을 바꾸면 거부한다', async () => {
    const { db, repo, tripId, original, context } = await withRecord();
    expect(original.sourceRefs).toHaveLength(1);
    const before = await snapshot(db, repo, tripId);
    const payload = memoOnly(tripId, original, '정정', context);
    const trip = await repo.get(tripId);
    const send = (row: ReturnType<typeof actualRecord>) =>
      repo.execute(
        envelope(tripId, 'CorrectActual', { supersedes: original.recordId, record: row }, trip.header.domainRevision),
      );
    await expect(send(actualRecord(tripId, payload, { supersedes: original.recordId }))).rejects.toThrow(
      'INVALID_INPUT',
    );
    await expect(
      send(
        actualRecord(
          tripId,
          { ...payload, planVersionId: trip.header.currentPlanVersionId },
          { supersedes: original.recordId, sourceRefs: original.sourceRefs },
        ),
      ),
    ).rejects.toThrow();
    expect(await snapshot(db, repo, tripId)).toEqual(before);
  });

  it('정정에서 장소를 바꾸면 새 장소의 현재 revision을 고정하고 원본의 당시 맥락은 남긴다', async () => {
    const { repo, tripId, original, placeId } = await withRecord();
    const newPlaceId = await addPlace(repo, tripId, '정정할 장소');
    const current = await repo.currentContext(tripId);
    const payload = actualPayload(
      original,
      edits(tripId, { placeId: newPlaceId, start: original.payload.time.start }),
      original.payload.contextRefs,
      current,
    );
    const trip = await repo.get(tripId);
    await repo.execute(
      envelope(
        tripId,
        'CorrectActual',
        {
          supersedes: original.recordId,
          record: actualRecord(tripId, payload, { supersedes: original.recordId, sourceRefs: original.sourceRefs }),
        },
        trip.header.domainRevision,
      ),
    );
    const [kept, fixed] = await actuals(repo, tripId);
    expect(kept.payload.placeRef?.entityId).toBe(placeId);
    expect(fixed.payload.placeRef?.entityId).toBe(newPlaceId);
    const pinned = fixed.payload.contextRefs.find((ref) => ref.entityId === newPlaceId);
    expect(pinned?.revisionId).toBe(head(trip, 'place', newPlaceId).revisionId);
    // 기존 장소의 당시 revision도 원본과 같은 값으로 유지된다.
    expect(fixed.payload.contextRefs.find((ref) => ref.entityId === placeId)).toEqual(
      original.payload.contextRefs.find((ref) => ref.entityId === placeId),
    );
    expect(kept.payload.contextRefs).toEqual(original.payload.contextRefs);
  });

  it('장소 이름·본문이 바뀌거나 장소가 비활성이 되어도 기록은 당시 내용으로 읽히고 정정할 수 있다', async () => {
    const { repo, tripId, original, placeId, context } = await withRecord();
    const trip = await repo.get(tripId);
    const place = content(trip, 'place', placeId) as Extract<ContentRevision, { kind: 'place' }>;
    const { commitSeq: _s, recordedAt: _r, actor: _a, ...rest } = place;
    await repo.execute(
      envelope(
        tripId,
        'UpdateContent',
        {
          expectedRevisionId: place.revisionId,
          content: {
            ...rest,
            revisionId: uuid(),
            previousRevisionId: place.revisionId,
            payload: { ...place.payload, name: '새 이름', summary: '새 요약' },
          },
        },
        trip.header.domainRevision,
      ),
    );
    const pinned = original.payload.contextRefs.find((ref) => ref.entityId === placeId)!;
    const then = await repo.content(tripId, 'place', placeId, pinned.revisionId);
    expect(then?.kind === 'place' && then.payload.name).toBe('가상 장소');
    expect(then?.kind === 'place' && then.payload.summary).toBe('당시 요약');
    const now = await repo.content(tripId, 'place', placeId);
    expect(now?.kind === 'place' && now.payload.name).toBe('새 이름');
    // 비활성이 된 장소가 이미 연결된 기록은 장소를 유지한 채 계속 정정할 수 있다.
    const after = await repo.get(tripId);
    await repo.execute(
      envelope(
        tripId,
        'DeactivateContent',
        {
          target: { targetKind: 'place', entityId: placeId, revisionId: head(after, 'place', placeId).revisionId },
        },
        after.header.domainRevision,
      ),
    );
    const payload = memoOnly(tripId, original, '비활성 뒤 정정', context);
    const latest = await repo.get(tripId);
    await repo.execute(
      envelope(
        tripId,
        'CorrectActual',
        {
          supersedes: original.recordId,
          record: actualRecord(tripId, payload, { supersedes: original.recordId, sourceRefs: original.sourceRefs }),
        },
        latest.header.domainRevision,
      ),
    );
    expect((await actuals(repo, tripId))[1].payload.note).toBe('비활성 뒤 정정');
  });
});

describe('규칙 함수', () => {
  const ref = (targetKind: string, entityId: string, revisionId: string) =>
    ({ tripId: 't', targetKind, entityId, revisionId }) as RevisionRef;

  it('장소를 바꾸면 새 장소의 현재 revision을 더하고 기존 항목의 당시 revision은 유지한다', () => {
    const baseContext = [ref('place', 'a', 'a1')];
    const current = [ref('place', 'a', 'a2'), ref('place', 'b', 'b1'), ref('region', 'r', 'r1')];
    expect(contextWithPlace(baseContext, current, 'zzz')).toEqual(baseContext);
    const result = contextWithPlace(baseContext, current, 'b');
    expect(result.find((r) => r.entityId === 'a')?.revisionId).toBe('a1');
    expect(result.find((r) => r.entityId === 'b')?.revisionId).toBe('b1');
    expect(result.find((r) => r.entityId === 'r')?.revisionId).toBe('r1');
  });
});
