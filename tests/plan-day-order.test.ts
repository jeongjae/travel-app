import { afterEach, expect, it } from 'vitest';
import { ContentRepository, TravelDB } from '../src/repository';
import { buildNewTrip } from '../src/content/trip-factory';

/** 저장 키 순서가 아니라 날짜 순서(ordinal)로 계획의 날짜를 돌려준다. 가상 여행만 사용한다. */
const databases: TravelDB[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close();
    await database.delete();
  }
});

it('계획 조회는 날짜 행 ID 순서와 무관하게 ordinal 순서로 돌려준다', async () => {
  const database = new TravelDB(`day-order-${crypto.randomUUID()}`);
  databases.push(database);
  const repo = new ContentRepository(database);
  await repo.init();
  const trip = buildNewTrip({ name: '가상 날짜 순서', start: '2033-05-01', end: '2033-05-03' });
  // 첫날의 ID가 키 정렬에서 가장 뒤로 가도록 거꾸로 부여한다.
  trip.initialPlan.days.forEach((day, index) => {
    day.dayId = `day-${String.fromCharCode(122 - index)}`;
  });
  await repo.execute({
    format: 'travel-app-command',
    commandVersion: 2,
    normalizationVersion: 'c02',
    tripId: trip.tripId,
    requestId: crypto.randomUUID(),
    kind: 'CreateTrip',
    payload: { header: trip.header, initialPlan: trip.initialPlan },
  });
  const plan = await repo.plan(trip.tripId, trip.header.currentPlanVersionId);
  expect(plan.days.map((day) => day.date)).toEqual(['2033-05-01', '2033-05-02', '2033-05-03']);
  expect((await repo.get(trip.tripId)).plans[0].days.map((day) => day.date)).toEqual(plan.days.map((day) => day.date));
});
