import { afterEach, describe, expect, it } from 'vitest';
import { ContentRepository, TravelDB } from '../src/repository';
import { buildNewTrip } from '../src/content/trip-factory';
import type { PlanVersion } from '../src/contracts/v2/index';

/** C-01 T-C3.1: 작성한 장소를 기존 item 연산으로 일정에 연결한다. 가상 여행만 사용한다. */
const databases: TravelDB[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close();
    await database.delete();
  }
});

const uuid = () => crypto.randomUUID();
const envelope = (tripId: string, kind: string, payload: unknown, expectedDomainRevision?: number) => ({
  format: 'travel-app-command',
  commandVersion: 2,
  normalizationVersion: 'c01',
  tripId,
  requestId: uuid(),
  kind,
  payload,
  ...(expectedDomainRevision === undefined ? {} : { expectedDomainRevision }),
});
const sections = ['why_go', 'deep', 'practical'].map((key, order) => ({
  key,
  title: key,
  order,
  bodyMd: `${key} 본문`,
  factRefs: [],
  assetRefs: [],
  linkRefs: [],
}));

async function setup() {
  const db = new TravelDB(`authoring-${uuid()}`);
  databases.push(db);
  const repo = new ContentRepository(db);
  await repo.init();
  return { db, repo };
}

async function tripWithPlace(repo: ContentRepository) {
  const trip = buildNewTrip({ name: '가상 작성 여행', start: '2032-05-01', end: '2032-05-02' });
  await repo.execute(envelope(trip.tripId, 'CreateTrip', { header: trip.header, initialPlan: trip.initialPlan }));
  const tripId = trip.tripId;
  const regionId = uuid();
  const placeId = uuid();
  const guideId = uuid();
  const base = { tripId, schemaVersion: 2, sourceRefs: [] };
  await repo.execute(
    envelope(
      tripId,
      'CreateContentBatch',
      {
        create: [
          {
            ...base,
            kind: 'region',
            entityId: regionId,
            revisionId: uuid(),
            payload: { name: '가상 지역', guideIds: [], assetRefs: [] },
          },
          {
            ...base,
            kind: 'place',
            entityId: placeId,
            revisionId: uuid(),
            payload: {
              regionIds: [regionId],
              name: '가상 장소',
              aliases: [],
              placeKind: 'sight',
              summary: '가상 요약',
              dontMiss: [],
              guideId,
              assetRefs: [],
            },
          },
          {
            ...base,
            kind: 'guide',
            entityId: guideId,
            revisionId: uuid(),
            payload: {
              documentKind: 'place-guide',
              ownerRef: { tripId, targetKind: 'place', entityId: placeId },
              title: '가상 장소 본문',
              sections,
              factBindings: [],
              assetRefs: [],
            },
          },
        ],
        updateOwners: [],
      },
      0,
    ),
  );
  return { tripId, placeId, guideId, regionId };
}

const item = (
  plan: PlanVersion,
  placeId: string | undefined,
  order: number,
  title: string,
  dayIndex = 0,
  time = '09:00',
): PlanVersion['items'][number] => ({
  tripId: plan.tripId,
  planVersionId: plan.planVersionId,
  activityId: uuid(),
  dayId: plan.days[dayIndex].dayId,
  order,
  title,
  category: 'activity',
  time: {
    start: { precision: 'local', date: plan.days[dayIndex].date, localTime: time, timeZoneStatus: 'unknown' },
  },
  summary: '',
  optional: false,
  placeLinks: placeId ? [{ placeId, relation: 'visit' }] : [],
  bookingIds: [],
  taskRefs: [],
  executionMarkers: [],
  sourceFlags: [],
});

const changePlan = (tripId: string, plan: PlanVersion, items: PlanVersion['items'], revision: number) =>
  envelope(
    tripId,
    'ChangePlan',
    {
      currentPlanVersionId: plan.planVersionId,
      operations: items.map((value) => ({ type: 'upsert-item', item: value })),
      reason: '가상 일정 연결',
    },
    revision,
  );

describe('작성한 장소의 일정 연결', () => {
  it('새 계획 버전에 장소 링크를 남기고 이전 계획은 그대로 둔다', async () => {
    const { repo } = await setup();
    const { tripId, placeId } = await tripWithPlace(repo);
    const before = await repo.get(tripId);
    const plan = before.plans[0];
    await repo.execute(changePlan(tripId, plan, [item(plan, placeId, 0, '가상 장소')], before.header.domainRevision));
    const after = await repo.get(tripId);
    expect(after.plans).toHaveLength(2);
    expect(after.plans[0]).toEqual(before.plans[0]);
    const latest = after.plans[1];
    expect(latest.items[0].placeLinks).toEqual([{ placeId, relation: 'visit' }]);
    expect(latest.contextRefs.some((ref) => ref.targetKind === 'place' && ref.entityId === placeId)).toBe(true);
    expect(latest.reason).toBe('가상 일정 연결');
  });

  it('순서와 시간을 바꾸면 새 계획 버전으로 저장되고 이전 버전은 보존된다', async () => {
    const { repo } = await setup();
    const { tripId, placeId } = await tripWithPlace(repo);
    let trip = await repo.get(tripId);
    const first = item(trip.plans[0], placeId, 0, '첫 활동');
    const second = item(trip.plans[0], undefined, 1, '둘째 활동', 0, '13:00');
    await repo.execute(changePlan(tripId, trip.plans[0], [first, second], trip.header.domainRevision));
    trip = await repo.get(tripId);
    const plan = trip.plans[1];
    const swap = [
      { ...plan.items.find((i) => i.title === '첫 활동')!, order: 1 },
      {
        ...plan.items.find((i) => i.title === '둘째 활동')!,
        order: 0,
        time: {
          start: {
            precision: 'local' as const,
            date: plan.days[0].date,
            localTime: '08:30',
            timeZoneStatus: 'unknown' as const,
          },
        },
      },
    ];
    await repo.execute(changePlan(tripId, plan, swap, trip.header.domainRevision));
    const after = await repo.get(tripId);
    expect(after.plans).toHaveLength(3);
    expect(after.plans[1]).toEqual(trip.plans[1]);
    const ordered = after.plans[2].items.toSorted((a, b) => a.order - b.order).map((i) => i.title);
    expect(ordered).toEqual(['둘째 활동', '첫 활동']);
    const moved = after.plans[2].items.find((i) => i.title === '둘째 활동')!;
    expect(moved.time.start).toMatchObject({ localTime: '08:30' });
  });

  it('같은 계획 ID라도 다른 탭의 현장 기록으로 여행 revision이 바뀌었으면 저장을 거부한다', async () => {
    const { repo } = await setup();
    const { tripId, placeId } = await tripWithPlace(repo);
    const trip = await repo.get(tripId);
    const stale = changePlan(
      tripId,
      trip.plans[0],
      [item(trip.plans[0], placeId, 0, '낡은 저장')],
      trip.header.domainRevision,
    );
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
        trip.header.domainRevision,
      ),
    );
    const mid = await repo.get(tripId);
    await expect(repo.execute(stale)).rejects.toThrow('CONFLICT');
    const after = await repo.get(tripId);
    expect(after.plans).toEqual(mid.plans);
    expect(after.records).toEqual(mid.records);
  });

  it('작성한 콘텐츠·연결·계획 이력을 전체 백업 뒤 빈 공간에 복원한다', async () => {
    const source = await setup();
    const { tripId, placeId } = await tripWithPlace(source.repo);
    const trip = await source.repo.get(tripId);
    await source.repo.execute(
      changePlan(tripId, trip.plans[0], [item(trip.plans[0], placeId, 0, '복원 활동')], trip.header.domainRevision),
    );
    const expected = await source.repo.get(tripId);
    const backup = await source.repo.createBackup();
    const target = await setup();
    const job = await target.repo.prepareRestore(backup.blob);
    expect(await target.repo.list()).toEqual([]);
    await target.repo.activateRestore(job);
    const restored = await target.repo.get(tripId);
    expect(restored.plans).toEqual(expected.plans);
    expect(restored.contents).toEqual(expected.contents);
    expect(restored.heads).toEqual(expected.heads);
    expect(restored.header).toEqual(expected.header);
  });
});
