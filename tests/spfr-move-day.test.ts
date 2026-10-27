import { afterEach, describe, expect, it } from 'vitest';
import { ContentRepository, TravelDB } from '../src/repository';
import { canonicalJson } from '../src/contracts/v2';
import { buildPackage, readPackage } from '../src/transfer/package';
import { normalizeSpfrPilot } from '../src/transfer/spfr-pilot';
import { spfrPilotFixture } from './fixtures/spfr-pilot';
import { spfrReturnTripFixture } from './fixtures/spfr-return-trip';

// 가상 원천: day-30(2033-05-03)은 "fiction"을 checkout 하고 "other"에서 숙박하는 이동일이다.
const moveDayId = 'day-30';
const returnTripId = 'fiction-pilot';
const soloTripId = 'fiction-solo';

const databases: TravelDB[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close();
    await database.delete();
  }
});

async function normalizeMoveTrip() {
  const fixture = await spfrReturnTripFixture('unknown');
  const result = await normalizeSpfrPilot(fixture.extract, fixture.options);
  expect(result.report.blocking).toEqual([]);
  return { fixture, result, plan: result.dataset.plans[0] };
}

async function packageOf(
  result: Awaited<ReturnType<typeof normalizeSpfrPilot>>,
  media: { sha256: string; bytes: Uint8Array }[],
  lineageId: string,
) {
  const packaged = await buildPackage(
    result.dataset,
    new Map([...media.map((file) => [file.sha256, file.bytes] as const), ...result.generatedAssets]),
    {
      sourceRepository: 'fiction/source',
      sourceCommit: 'a'.repeat(40),
      lineageId,
      adapterVersion: 'spfr-pilot-v2',
      normalizationVersion: '2',
    },
    result.report,
    result.mappings,
  );
  return readPackage(packaged.blob);
}

async function importPackage(repository: ContentRepository, imported: Awaited<ReturnType<typeof packageOf>>) {
  await repository.prepareImport(imported.dataset, imported.assets, imported.provenance);
  await repository.execute({
    format: 'travel-app-command',
    commandVersion: 2,
    normalizationVersion: 'spfr-pilot-v2',
    requestId: crypto.randomUUID(),
    tripId: imported.dataset.header.tripId,
    kind: 'ImportNewTrip',
    payload: { packageId: imported.provenance.packageId, packageDigest: imported.provenance.packageDigest },
  });
}

async function newRepository() {
  const database = new TravelDB(`move-day-${crypto.randomUUID()}`);
  databases.push(database);
  const repository = new ContentRepository(database);
  await repository.init();
  return repository;
}

describe('T-01b · 하루 안의 복수 지역 이동', () => {
  it('이동일의 도시 표기·일차·날짜가 원천 그대로이고 숙박 지역은 도착 지역 하나다', async () => {
    const { plan } = await normalizeMoveTrip();
    const moveDay = plan.days.find((day) => day.dayId === moveDayId)!;
    expect(moveDay).toMatchObject({
      ordinal: 3,
      date: '2033-05-03',
      cityText: '가상 지역 → 다른 지역',
      dayType: 'transfer',
    });
    // 출발 지역 "fiction"의 숙박은 이 날 아침 끝나므로 숙박 지역은 도착 지역뿐이다.
    expect(moveDay.overnightRegionId).toBe('other');
    expect(moveDay.regionIds).toEqual(['other']);
  });

  it('도시 표기와 활동의 장소가 숙박 지역 하나로 축소되지 않고 두 지역을 모두 가리킨다', async () => {
    const { plan, result } = await normalizeMoveTrip();
    const moveItems = plan.items.filter((item) => item.dayId === moveDayId).toSorted((a, b) => a.order - b.order);
    expect(moveItems.map((item) => [item.activityId, item.order, item.placeLinks])).toEqual([
      ['day-30-depart', 0, [{ placeId: 'fiction-place', relation: 'visit' }]],
      ['day-30-arrive', 1, [{ placeId: 'other-spot', relation: 'visit' }]],
    ]);
    const placeRegions = (placeId: string) => {
      const place = result.dataset.contents.find((content) => content.kind === 'place' && content.entityId === placeId);
      return place?.kind === 'place' ? place.payload.regionIds : undefined;
    };
    expect(placeRegions('fiction-place')).toEqual(['fiction']);
    expect(placeRegions('other-spot')).toEqual(['other']);
    const regionIds = result.dataset.contents.filter((content) => content.kind === 'region').map((c) => c.entityId);
    expect(regionIds.toSorted()).toEqual(['fiction', 'other']);
  });

  it('활동 연결·시각·이동 구간은 원천 값만 쓰고 없는 방문·시각을 만들지 않는다', async () => {
    const { plan } = await normalizeMoveTrip();
    const depart = plan.items.find((item) => item.activityId === 'day-30-depart')!;
    const arrive = plan.items.find((item) => item.activityId === 'day-30-arrive')!;
    expect(depart.time).toEqual({
      start: { precision: 'local', date: '2033-05-03', localTime: '09:00', timeZoneStatus: 'unknown' },
      end: { precision: 'local', date: '2033-05-03', localTime: '10:00', timeZoneStatus: 'unknown' },
    });
    // 도착 활동은 시작만 있고 끝은 원천에 없으므로 만들지 않는다.
    expect(arrive.time).toEqual({
      start: { precision: 'local', date: '2033-05-03', localTime: '12:30', timeZoneStatus: 'unknown' },
    });
    const moveLegs = plan.legs.filter((leg) => leg.dayId === moveDayId);
    expect(moveLegs).toHaveLength(1);
    expect(moveLegs[0]).toMatchObject({
      fromActivityId: 'day-30-depart',
      toActivityId: 'day-30-arrive',
      mode: 'train',
      durationText: '약 2시간',
      lineText: '가상 노선',
    });
    // 이동일 외의 날에는 이동 구간이 없고 다른 날의 활동이 이동일로 옮겨지지 않았다.
    expect(plan.legs.filter((leg) => leg.dayId !== moveDayId)).toEqual([]);
    expect(plan.items.filter((item) => item.dayId === moveDayId)).toHaveLength(2);
    expect(plan.items.find((item) => item.activityId === 'day-29-stroll')?.dayId).toBe('day-29');
  });

  it('이동일 앞뒤 날짜의 지역은 이동일의 지역과 섞이지 않는다', async () => {
    const { plan } = await normalizeMoveTrip();
    const regionsByDay = Object.fromEntries(plan.days.map((day) => [day.dayId, day.regionIds]));
    expect(regionsByDay).toEqual({
      'day-28': ['fiction'],
      'day-29': ['fiction'],
      'day-30': ['other'],
      'day-31': [],
    });
  });

  it('패키지 왕복 뒤 repository 조회에서도 이동일 의미와 연결이 같고 다른 여행에 섞이지 않는다', async () => {
    const { fixture, result, plan } = await normalizeMoveTrip();
    const imported = await packageOf(result, fixture.options.media, 'fiction-return');
    expect(canonicalJson(imported.dataset)).toBe(canonicalJson(result.dataset));

    const repository = await newRepository();
    await importPackage(repository, imported);
    const stored = await repository.get(returnTripId);
    const storedPlan = await repository.plan(returnTripId, plan.planVersionId);
    expect(storedPlan.days.find((day) => day.dayId === moveDayId)).toEqual(
      plan.days.find((day) => day.dayId === moveDayId),
    );
    // repository.plan()은 저장 순서로 돌려주므로 활동 순서는 order 필드로 비교한다.
    const moveItemsByOrder = (items: typeof plan.items) =>
      items.filter((item) => item.dayId === moveDayId).toSorted((a, b) => a.order - b.order);
    expect(moveItemsByOrder(storedPlan.items)).toEqual(moveItemsByOrder(plan.items));
    expect(moveItemsByOrder(stored.plans[0].items)).toEqual(moveItemsByOrder(plan.items));
    expect(storedPlan.legs).toEqual(plan.legs);
    const storedOther = await repository.content(returnTripId, 'place', 'other-spot');
    expect(storedOther?.kind === 'place' && storedOther.payload.regionIds).toEqual(['other']);

    // 같은 repository에 지역 "other"와 장소 "other-spot"이 없는 별도 가상 여행을 넣어도 첫 여행은 그대로다.
    const solo = await spfrPilotFixture();
    const soloResult = await normalizeSpfrPilot(solo.extract, { ...solo.options, tripId: soloTripId });
    expect(soloResult.report.blocking).toEqual([]);
    await importPackage(repository, await packageOf(soloResult, solo.options.media, 'fiction-solo'));
    expect(await repository.get(returnTripId)).toEqual(stored);
    expect(await repository.list()).toHaveLength(2);

    const soloTrip = await repository.get(soloTripId);
    const soloRegions = soloTrip.contents.filter((content) => content.kind === 'region').map((c) => c.entityId);
    expect(soloRegions).toEqual(['fiction']);
    expect(soloTrip.plans[0].days.map((day) => day.dayId)).toEqual(['day-28']);
    expect(await repository.content(soloTripId, 'place', 'other-spot')).toBeUndefined();
    expect(await repository.content(soloTripId, 'region', 'other')).toBeUndefined();
  });
});
