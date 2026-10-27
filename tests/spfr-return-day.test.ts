import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../src/contracts/v2';
import { buildPackage, readPackage } from '../src/transfer/package';
import { normalizeSpfrPilot } from '../src/transfer/spfr-pilot';
import { spfrReturnTripFixture, type ReturnDayRegions } from './fixtures/spfr-return-trip';

// 가상 원천: day-31(2033-05-04)은 마지막 날이고 "other" 숙박이 그날 아침 checkout 된다. 그날 자신의 숙박은 없다.
const lastDayId = 'day-31';
const lastDate = '2033-05-04';

async function normalizeReturnTrip(returnDay: ReturnDayRegions) {
  const fixture = await spfrReturnTripFixture(returnDay);
  const result = await normalizeSpfrPilot(fixture.extract, fixture.options);
  expect(result.report.blocking).toEqual([]);
  expect(result.report.packageReady).toBe(true);
  return { fixture, result, plan: result.dataset.plans[0] };
}

describe('T-01a · 숙박 없는 마지막 귀국일', () => {
  it('마지막 날이 누락되지 않고 날짜·일차·활동 순서가 원천 값 그대로 유지된다', async () => {
    const { plan } = await normalizeReturnTrip('unknown');
    expect(plan.days.map((day) => day.dayId)).toEqual(['day-28', 'day-29', 'day-30', lastDayId]);
    const lastDay = plan.days.at(-1)!;
    expect(lastDay).toMatchObject({ dayId: lastDayId, ordinal: 4, date: lastDate, cityText: '가상 귀국' });
    expect(lastDay.title).toBe('가상 귀국일');
    expect(lastDay.dayType).toBe('return');
    const lastItems = plan.items.filter((item) => item.dayId === lastDayId).toSorted((a, b) => a.order - b.order);
    expect(lastItems.map((item) => [item.activityId, item.order, item.title])).toEqual([
      ['day-31-airport', 0, '가상 공항'],
      ['day-31-gift', 1, '가상 선물 가게'],
    ]);
    expect(lastItems.map((item) => item.time.start)).toEqual([
      { precision: 'local', date: lastDate, localTime: '08:00', timeZoneStatus: 'unknown' },
      { precision: 'local', date: lastDate, localTime: '11:00', timeZoneStatus: 'unknown' },
    ]);
  });

  it('앞날의 숙박·지역을 상속하거나 없는 숙박을 만들지 않는다', async () => {
    const { plan } = await normalizeReturnTrip('unknown');
    const lastDay = plan.days.at(-1)!;
    expect(lastDay.regionIds).toEqual([]);
    expect(lastDay.overnightRegionId).toBeUndefined();
    // 숙박은 원천의 두 건뿐이며 마지막 날짜에서 시작하거나 마지막 날짜를 덮는 숙박이 없다.
    expect(plan.stays).toHaveLength(2);
    expect(plan.stays.map((stay) => [stay.regionId, stay.time.start.date, stay.time.end?.date])).toEqual([
      ['fiction', '2033-05-01', '2033-05-03'],
      ['other', '2033-05-03', lastDate],
    ]);
    for (const stay of plan.stays) {
      const covers = stay.time.start.date! <= lastDate && lastDate < stay.time.end!.date!;
      expect(covers).toBe(false);
    }
  });

  it('원천에 지역이 없는 활동에는 지역·방문 장소를 추정해 붙이지 않는다', async () => {
    const { plan, result } = await normalizeReturnTrip('unknown');
    for (const item of plan.items.filter((value) => value.dayId === lastDayId)) {
      expect(item.placeLinks).toEqual([]);
      expect(item.mapTargetId).toBeUndefined();
      expect(item.bookingIds).toEqual([]);
    }
    const lastDayMaps = result.dataset.contents.filter(
      (content) => content.kind === 'map-target' && content.entityId.includes(lastDayId),
    );
    expect(lastDayMaps).toEqual([]);
  });

  it('원천에 지역이 명시된 장소는 그 지역을 보존하되 날짜에 숙박 지역을 만들지 않는다', async () => {
    const { plan, result } = await normalizeReturnTrip('explicit');
    const gift = plan.items.find((item) => item.activityId === 'day-31-gift')!;
    expect(gift.placeLinks).toEqual([{ placeId: 'other-spot', relation: 'visit' }]);
    const place = result.dataset.contents.find(
      (content) => content.kind === 'place' && content.entityId === 'other-spot',
    );
    expect(place?.kind === 'place' && place.payload.regionIds).toEqual(['other']);
    expect(result.dataset.contents.some((content) => content.kind === 'region' && content.entityId === 'other')).toBe(
      true,
    );
    // 명시된 장소 지역이 있어도 숙박이 없는 마지막 날에 숙박 지역(overnightRegionId)은 생기지 않는다.
    const lastDay = plan.days.at(-1)!;
    expect(lastDay.overnightRegionId).toBeUndefined();
    expect(plan.stays).toHaveLength(2);
    const airport = plan.items.find((item) => item.activityId === 'day-31-airport')!;
    expect(airport.placeLinks).toEqual([]);
  });

  it('귀국일을 포함해도 다른 날의 일자·활동·이동은 귀국일 없는 변환과 같다', async () => {
    const fixture = await spfrReturnTripFixture('unknown');
    const withLastDay = (await normalizeSpfrPilot(fixture.extract, fixture.options)).dataset.plans[0];
    const withoutLastDay = (await normalizeSpfrPilot(fixture.extract, { ...fixture.options, days: [28, 29, 30] }))
      .dataset.plans[0];
    const keepOtherDays = <T extends { dayId: string }>(rows: T[]) => rows.filter((row) => row.dayId !== lastDayId);
    expect(keepOtherDays(withLastDay.days)).toEqual(withoutLastDay.days);
    expect(keepOtherDays(withLastDay.items)).toEqual(withoutLastDay.items);
    expect(keepOtherDays(withLastDay.legs)).toEqual(withoutLastDay.legs);
    expect(withLastDay.stays).toEqual(withoutLastDay.stays);
  });

  it('패키지를 만들고 다시 읽어도 귀국일의 의미와 참조가 같다', async () => {
    for (const returnDay of ['unknown', 'explicit'] as const) {
      const { fixture, result, plan } = await normalizeReturnTrip(returnDay);
      const packaged = await buildPackage(
        result.dataset,
        new Map([
          ...fixture.options.media.map((file) => [file.sha256, file.bytes] as const),
          ...result.generatedAssets,
        ]),
        {
          sourceRepository: 'fiction/source',
          sourceCommit: 'a'.repeat(40),
          lineageId: 'fiction-return',
          adapterVersion: 'spfr-pilot-v2',
          normalizationVersion: '2',
        },
        result.report,
        result.mappings,
      );
      const reread = (await readPackage(packaged.blob)).dataset;
      expect(canonicalJson(reread)).toBe(canonicalJson(result.dataset));
      const rereadPlan = reread.plans[0];
      expect(rereadPlan.days.at(-1)).toEqual(plan.days.at(-1));
      expect(rereadPlan.items.filter((item) => item.dayId === lastDayId)).toEqual(
        plan.items.filter((item) => item.dayId === lastDayId),
      );
      expect(rereadPlan.stays).toEqual(plan.stays);
    }
  });
});

// 아래 블록은 계약 검증이 아니라 현 구현의 day.regionIds 값을 기록한 관찰이다.
// regionIds의 의미(숙박 전용인지, 활동 장소 지역을 포함하는지)는 문서·코드·소비자 어디에서도 확정되지 않았다.
// 근거와 판단 후보: docs/claude-task-01-r1-regionids.md. 의미가 정해지면 이 기대값은 계약 검증으로 승격하거나 바뀔 수 있다.
describe('[현 동작 관찰 · 계약 미확정] 귀국일 day.regionIds', () => {
  it('원천에 지역이 명시된 장소가 있어도 현재는 숙박이 없는 귀국일의 day.regionIds가 비어 있다', async () => {
    const { plan } = await normalizeReturnTrip('explicit');
    expect(plan.days.at(-1)!.regionIds).toEqual([]);
  });
});
