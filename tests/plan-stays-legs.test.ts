import { afterEach, describe, expect, it } from 'vitest';
import { ContentRepository, TravelDB } from '../src/repository';
import { buildNewTrip } from '../src/content/trip-factory';
import { planOperationSchema, validateCommand } from '../src/contracts/v2/index';
import type { PlanVersion } from '../src/contracts/v2/index';

/** C-02 T-C3.2: 숙박·이동 편집은 새 계획 버전 하나로 저장되고 이전 버전·기록은 변하지 않는다. 가상 여행만 사용한다. */
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
  normalizationVersion: 'c02',
  tripId,
  requestId,
  kind,
  payload,
  ...(expectedDomainRevision === undefined ? {} : { expectedDomainRevision }),
});

async function setup() {
  const db = new TravelDB(`stays-${uuid()}`);
  databases.push(db);
  const repo = new ContentRepository(db);
  await repo.init();
  return { db, repo };
}

/** 2033-05-01~05-04 네 날, 지역 둘(a, b)과 첫날에 활동 둘, 둘째 날에 활동 하나. */
async function fixture() {
  const { db, repo } = await setup();
  const trip = buildNewTrip({ name: '가상 숙박 여행', start: '2033-05-01', end: '2033-05-04' });
  const tripId = trip.tripId;
  await repo.execute(envelope(tripId, 'CreateTrip', { header: trip.header, initialPlan: trip.initialPlan }));
  const base = { tripId, schemaVersion: 2, sourceRefs: [] };
  const regionA = uuid();
  const regionB = uuid();
  const region = (entityId: string, name: string) => ({
    ...base,
    kind: 'region',
    entityId,
    revisionId: uuid(),
    payload: { name, guideIds: [], assetRefs: [] },
  });
  await repo.execute(
    envelope(
      tripId,
      'CreateContentBatch',
      { create: [region(regionA, '가'), region(regionB, '나')], updateOwners: [] },
      0,
    ),
  );
  const plan = (await repo.get(tripId)).plans[0];
  const item = (dayIndex: number, order: number, title: string): PlanVersion['items'][number] => ({
    tripId,
    planVersionId: plan.planVersionId,
    activityId: uuid(),
    dayId: plan.days[dayIndex].dayId,
    order,
    title,
    category: 'activity',
    time: { start: { precision: 'unspecified' } },
    summary: '',
    optional: false,
    placeLinks: [],
    bookingIds: [],
    taskRefs: [],
    executionMarkers: [],
    sourceFlags: [],
  });
  const items = [item(0, 0, '아침'), item(0, 1, '점심'), item(1, 0, '다음날')];
  await repo.execute(
    envelope(
      tripId,
      'ChangePlan',
      {
        currentPlanVersionId: plan.planVersionId,
        operations: items.map((value) => ({ type: 'upsert-item', item: value })),
        reason: '활동 준비',
      },
      1,
    ),
  );
  return { db, repo, tripId, regionA, regionB, items };
}

const stayOn = (
  plan: PlanVersion,
  regionId: string | undefined,
  checkin: string,
  checkout: string,
  stayId = uuid(),
  baseText = '가상 숙소',
): PlanVersion['stays'][number] => ({
  tripId: plan.tripId,
  planVersionId: plan.planVersionId,
  stayId,
  ...(regionId ? { regionId } : {}),
  baseText,
  time: { start: { precision: 'date', date: checkin }, end: { precision: 'date', date: checkout } },
  plannedNights: Math.round((Date.parse(checkout) - Date.parse(checkin)) / 86400000),
  locationStatus: 'user-entered',
});
const legBetween = (
  plan: PlanVersion,
  from: PlanVersion['items'][number],
  to: PlanVersion['items'][number],
  legId = uuid(),
) => ({
  tripId: plan.tripId,
  planVersionId: plan.planVersionId,
  legId,
  dayId: from.dayId,
  fromActivityId: from.activityId,
  toActivityId: to.activityId,
  mode: '도보',
  durationText: '15분',
});
const change = (
  tripId: string,
  plan: PlanVersion,
  revision: number,
  operations: unknown[],
  reason = '숙박·이동 편집',
  requestId = uuid(),
) =>
  envelope(tripId, 'ChangePlan', { currentPlanVersionId: plan.planVersionId, operations, reason }, revision, requestId);
const latest = async (repo: ContentRepository, tripId: string) => {
  const trip = await repo.get(tripId);
  return { trip, plan: trip.plans.find((p) => p.planVersionId === trip.header.currentPlanVersionId)! };
};
const regionsByDate = (plan: PlanVersion) =>
  Object.fromEntries(plan.days.map((d) => [d.date, [d.regionIds, d.overnightRegionId]]));

describe('숙박 편집', () => {
  it('숙박을 추가하면 새 계획 버전에서 닿는 날짜만 하루 지역·야간 지역이 바뀌고 이전 버전은 그대로다', async () => {
    const { repo, tripId, regionA } = await fixture();
    const { trip, plan } = await latest(repo, tripId);
    await repo.execute(
      change(tripId, plan, trip.header.domainRevision, [
        { type: 'upsert-stay', stay: stayOn(plan, regionA, '2033-05-01', '2033-05-03') },
      ]),
    );
    const after = await latest(repo, tripId);
    expect(after.trip.plans).toHaveLength(trip.plans.length + 1);
    expect(after.trip.plans.slice(0, trip.plans.length)).toEqual(trip.plans);
    expect(regionsByDate(after.plan)).toEqual({
      '2033-05-01': [[regionA], regionA],
      '2033-05-02': [[regionA], regionA],
      '2033-05-03': [[regionA], undefined],
      '2033-05-04': [[], undefined],
    });
    expect(after.plan.stays).toHaveLength(1);
    expect(after.plan.reason).toBe('숙박·이동 편집');
    expect(after.plan.items).toEqual(plan.items.map((i) => ({ ...i, planVersionId: after.plan.planVersionId })));
  });

  it('숙박 기간을 줄이거나 지역을 바꾸면 이전·새 기간에 닿는 날짜가 모두 갱신되고, 제거하면 비워진다', async () => {
    const { repo, tripId, regionA, regionB } = await fixture();
    let state = await latest(repo, tripId);
    const stayId = uuid();
    await repo.execute(
      change(tripId, state.plan, state.trip.header.domainRevision, [
        { type: 'upsert-stay', stay: stayOn(state.plan, regionA, '2033-05-01', '2033-05-04', stayId) },
      ]),
    );
    state = await latest(repo, tripId);
    await repo.execute(
      change(tripId, state.plan, state.trip.header.domainRevision, [
        { type: 'upsert-stay', stay: stayOn(state.plan, regionB, '2033-05-02', '2033-05-03', stayId) },
      ]),
    );
    state = await latest(repo, tripId);
    expect(regionsByDate(state.plan)).toEqual({
      '2033-05-01': [[], undefined],
      '2033-05-02': [[regionB], regionB],
      '2033-05-03': [[regionB], undefined],
      '2033-05-04': [[], undefined],
    });
    expect(state.plan.stays).toHaveLength(1);
    await repo.execute(change(tripId, state.plan, state.trip.header.domainRevision, [{ type: 'remove-stay', stayId }]));
    state = await latest(repo, tripId);
    expect(state.plan.stays).toEqual([]);
    expect(Object.values(regionsByDate(state.plan)).every(([ids, night]) => (ids?.length ?? 0) === 0 && !night)).toBe(
      true,
    );
  });

  it('숙박과 무관한 날짜·필드는 건드리지 않는다', async () => {
    const { repo, tripId, regionA } = await fixture();
    const { trip, plan } = await latest(repo, tripId);
    const untouched = plan.days[3];
    await repo.execute(
      change(tripId, plan, trip.header.domainRevision, [
        { type: 'upsert-stay', stay: stayOn(plan, regionA, '2033-05-01', '2033-05-02') },
      ]),
    );
    const after = (await latest(repo, tripId)).plan;
    const { planVersionId: _a, ...before } = untouched;
    const { planVersionId: _b, ...now } = after.days[3];
    expect(now).toEqual(before);
  });

  it('겹친 밤의 다른 지역·역전·박수 불일치·시간대 모호·없는/비활성 지역은 거부하고 상태를 바꾸지 않는다', async () => {
    const { db, repo, tripId, regionA, regionB } = await fixture();
    let state = await latest(repo, tripId);
    await repo.execute(
      change(tripId, state.plan, state.trip.header.domainRevision, [
        { type: 'upsert-stay', stay: stayOn(state.plan, regionA, '2033-05-01', '2033-05-03') },
      ]),
    );
    state = await latest(repo, tripId);
    const revisionId = (await repo.get(tripId)).heads.find((h) => h.entityId === regionB)!.revisionId;
    await repo.execute(
      envelope(
        tripId,
        'DeactivateContent',
        { target: { targetKind: 'region', entityId: regionB, revisionId } },
        state.trip.header.domainRevision,
      ),
    );
    state = await latest(repo, tripId);
    const before = { trip: state.trip, receipts: await db.table('command_receipts').count(), meta: await repo.meta() };
    const parisSeoul = {
      ...stayOn(state.plan, regionA, '2033-05-03', '2033-05-04'),
      time: {
        start: {
          precision: 'local',
          date: '2033-05-03',
          localTime: '15:00',
          timeZone: 'Europe/Paris',
          timeZoneStatus: 'confirmed',
        },
        end: {
          precision: 'local',
          date: '2033-05-04',
          localTime: '11:00',
          timeZone: 'Asia/Seoul',
          timeZoneStatus: 'confirmed',
        },
      },
    };
    const cases: [string, unknown, string][] = [
      ['겹친 밤', stayOn(state.plan, regionA, '2033-05-02', '2033-05-04', uuid()), '겹칩니다'],
      [
        '역전',
        {
          ...stayOn(state.plan, regionA, '2033-05-02', '2033-05-03'),
          time: { start: { precision: 'date', date: '2033-05-03' }, end: { precision: 'date', date: '2033-05-02' } },
        },
        '이릅니다',
      ],
      ['박수 불일치', { ...stayOn(state.plan, regionA, '2033-05-03', '2033-05-04'), plannedNights: 5 }, '박수'],
      ['시간대 모호', parisSeoul, '모호'],
      ['없는 지역', stayOn(state.plan, uuid(), '2033-05-03', '2033-05-04'), '지역이 없거나'],
      ['비활성 지역', stayOn(state.plan, regionB, '2033-05-03', '2033-05-04'), '지역이 없거나'],
    ];
    // '겹친 밤'은 같은 지역이면 허용되므로 다른 지역을 쓰도록 활성 지역을 하나 더 만든다.
    const regionC = uuid();
    await repo.execute(
      envelope(
        tripId,
        'CreateContentBatch',
        {
          create: [
            {
              tripId,
              schemaVersion: 2,
              sourceRefs: [],
              kind: 'region',
              entityId: regionC,
              revisionId: uuid(),
              payload: { name: '다', guideIds: [], assetRefs: [] },
            },
          ],
          updateOwners: [],
        },
        state.trip.header.domainRevision,
      ),
    );
    state = await latest(repo, tripId);
    const cleanBefore = {
      trip: state.trip,
      receipts: await db.table('command_receipts').count(),
      meta: await repo.meta(),
    };
    cases[0] = ['겹친 밤', stayOn(state.plan, regionC, '2033-05-02', '2033-05-04', uuid()), '겹칩니다'];
    for (const [, stay, message] of cases) {
      const target = { ...(stay as object), planVersionId: state.plan.planVersionId };
      await expect(
        repo.execute(
          change(tripId, state.plan, state.trip.header.domainRevision, [{ type: 'upsert-stay', stay: target }]),
        ),
      ).rejects.toThrow();
      expect({
        trip: await repo.get(tripId),
        receipts: await db.table('command_receipts').count(),
        meta: await repo.meta(),
      }).toEqual(cleanBefore);
    }
    expect(before.trip.plans.length).toBeLessThanOrEqual(cleanBefore.trip.plans.length);
  });
});

describe('이동 편집', () => {
  it('같은 날 두 활동 사이의 이동을 추가·수정·제거하고, 복합 변경을 한 계획 버전으로 저장한다', async () => {
    const { repo, tripId, regionA, items } = await fixture();
    let state = await latest(repo, tripId);
    const legId = uuid();
    const [morning, lunch] = items;
    await repo.execute(
      change(tripId, state.plan, state.trip.header.domainRevision, [
        { type: 'upsert-leg', leg: legBetween(state.plan, morning, lunch, legId) },
        { type: 'upsert-stay', stay: stayOn(state.plan, regionA, '2033-05-01', '2033-05-02') },
      ]),
    );
    const afterAdd = await latest(repo, tripId);
    expect(afterAdd.trip.plans).toHaveLength(state.trip.plans.length + 1);
    expect(afterAdd.plan.legs).toHaveLength(1);
    expect(afterAdd.plan.stays).toHaveLength(1);
    state = afterAdd;
    await repo.execute(
      change(tripId, state.plan, state.trip.header.domainRevision, [
        {
          type: 'upsert-leg',
          leg: { ...legBetween(state.plan, morning, lunch, legId), mode: '버스', distanceText: '2km' },
        },
      ]),
    );
    state = await latest(repo, tripId);
    expect(state.plan.legs).toMatchObject([{ legId, mode: '버스', distanceText: '2km' }]);
    await repo.execute(change(tripId, state.plan, state.trip.header.domainRevision, [{ type: 'remove-leg', legId }]));
    state = await latest(repo, tripId);
    expect(state.plan.legs).toEqual([]);
    expect(state.plan.stays).toHaveLength(1);
  });

  it('다른 날 활동·없는 활동·같은 활동을 잇는 이동은 거부한다', async () => {
    const { db, repo, tripId, items } = await fixture();
    const state = await latest(repo, tripId);
    const before = await repo.get(tripId);
    const [morning, lunch, nextDay] = items;
    const bad = [
      legBetween(state.plan, morning, nextDay),
      legBetween(state.plan, morning, { ...lunch, activityId: uuid() }),
      legBetween(state.plan, morning, morning),
    ];
    for (const leg of bad) {
      await expect(
        repo.execute(change(tripId, state.plan, state.trip.header.domainRevision, [{ type: 'upsert-leg', leg }])),
      ).rejects.toThrow();
    }
    expect(await repo.get(tripId)).toEqual(before);
    expect(await db.table('command_receipts').count()).toBeGreaterThan(0);
  });

  it('활동을 제거하거나 다른 날로 옮기면 연결된 이동도 함께 사라져 고아 이동이 남지 않는다', async () => {
    const { repo, tripId, items } = await fixture();
    let state = await latest(repo, tripId);
    const [morning, lunch] = items;
    await repo.execute(
      change(tripId, state.plan, state.trip.header.domainRevision, [
        { type: 'upsert-leg', leg: legBetween(state.plan, morning, lunch) },
      ]),
    );
    state = await latest(repo, tripId);
    const moved = {
      ...state.plan.items.find((i) => i.activityId === lunch.activityId)!,
      dayId: state.plan.days[2].dayId,
      order: 0,
    };
    await repo.execute(
      change(tripId, state.plan, state.trip.header.domainRevision, [{ type: 'upsert-item', item: moved }]),
    );
    state = await latest(repo, tripId);
    expect(state.plan.legs).toEqual([]);
    expect(state.plan.items.find((i) => i.activityId === lunch.activityId)?.dayId).toBe(state.plan.days[2].dayId);
    // 이전 계획 버전은 이동을 그대로 가지고 있다.
    expect(state.trip.plans.some((p) => p.legs.length === 1)).toBe(true);
  });
});

describe('저장 경계', () => {
  it('오래된 계획 ID·오래된 도메인 revision(다른 탭의 현장 기록)은 거부하고, 같은 요청은 다시 쓰지 않는다', async () => {
    const { db, repo, tripId, regionA } = await fixture();
    const state = await latest(repo, tripId);
    const request = change(tripId, state.plan, state.trip.header.domainRevision, [
      { type: 'upsert-stay', stay: stayOn(state.plan, regionA, '2033-05-01', '2033-05-02') },
    ]);
    await repo.execute(
      envelope(
        tripId,
        'AddNote',
        {
          record: {
            tripId,
            recordId: uuid(),
            kind: 'note',
            sourceRefs: [],
            payload: {
              targetRef: { tripId, targetKind: 'trip', entityId: tripId },
              body: '다른 탭 메모',
              contextRefs: [],
            },
          },
        },
        state.trip.header.domainRevision,
      ),
    );
    const mid = await repo.get(tripId);
    await expect(repo.execute(request)).rejects.toThrow('CONFLICT');
    expect(await repo.get(tripId)).toEqual(mid);
    const fresh = change(tripId, state.plan, mid.header.domainRevision, [
      { type: 'upsert-stay', stay: stayOn(state.plan, regionA, '2033-05-01', '2033-05-02') },
    ]);
    const first = await repo.execute(fresh);
    const receipts = await db.table('command_receipts').count();
    const again = await repo.execute(fresh);
    expect(again.status).toBe('replayed');
    expect(await db.table('command_receipts').count()).toBe(receipts);
    expect(first.domainRevision).toBe(mid.header.domainRevision + 1);
    const stale = change(tripId, { ...state.plan, planVersionId: uuid() }, mid.header.domainRevision + 1, [
      { type: 'remove-leg', legId: 'none' },
    ]);
    await expect(repo.execute(stale)).rejects.toThrow('CONFLICT');
  });

  it('저장 도중 쓰기가 실패하면 계획·영수증이 모두 남지 않는다', async () => {
    const { db, repo, tripId, regionA } = await fixture();
    const state = await latest(repo, tripId);
    const before = {
      trip: await repo.get(tripId),
      receipts: await db.table('command_receipts').count(),
      meta: await repo.meta(),
    };
    const receipts = db.table('command_receipts');
    const originalAdd = receipts.add.bind(receipts);
    receipts.add = (() => {
      throw new DOMException('가상 쓰기 실패', 'QuotaExceededError');
    }) as typeof receipts.add;
    const request = change(tripId, state.plan, state.trip.header.domainRevision, [
      { type: 'upsert-stay', stay: stayOn(state.plan, regionA, '2033-05-01', '2033-05-02') },
    ]);
    await expect(repo.execute(request)).rejects.toThrow();
    receipts.add = originalAdd;
    expect({
      trip: await repo.get(tripId),
      receipts: await db.table('command_receipts').count(),
      meta: await repo.meta(),
    }).toEqual(before);
    await repo.execute(request);
    expect((await latest(repo, tripId)).plan.stays).toHaveLength(1);
  });

  it('변경안·AI 경계는 항목 연산에 머문다', () => {
    const stay = { type: 'upsert-stay', stay: { stayId: 's' } };
    expect(planOperationSchema.safeParse(stay).success).toBe(false);
    expect(planOperationSchema.safeParse({ type: 'remove-leg', legId: 'l' }).success).toBe(false);
    expect(() =>
      validateCommand(envelope('t', 'SaveProposal', { baseDomainRevision: 0, proposal: { operations: [stay] } })),
    ).toThrow();
  });

  it('숙박·이동이 든 계획과 이력을 전체 백업 뒤 빈 공간에 복원한다', async () => {
    const source = await fixture();
    const { repo, tripId, regionA, items } = source;
    const state = await latest(repo, tripId);
    await repo.execute(
      change(tripId, state.plan, state.trip.header.domainRevision, [
        { type: 'upsert-stay', stay: stayOn(state.plan, regionA, '2033-05-01', '2033-05-03') },
        { type: 'upsert-leg', leg: legBetween(state.plan, items[0], items[1]) },
      ]),
    );
    const expected = await repo.get(tripId);
    const backup = await repo.createBackup();
    const target = await setup();
    const job = await target.repo.prepareRestore(backup.blob);
    expect(await target.repo.list()).toEqual([]);
    await target.repo.activateRestore(job);
    const restored = await target.repo.get(tripId);
    expect(restored.plans).toEqual(expected.plans);
    expect(restored.header).toEqual(expected.header);
    expect(restored.plans.at(-1)!.stays).toHaveLength(1);
    expect(restored.plans.at(-1)!.legs).toHaveLength(1);
  });
});
