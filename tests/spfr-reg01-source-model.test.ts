import { describe, expect, it } from 'vitest';
import { normalizeSpfrPilot } from '../src/transfer/spfr-pilot';
import { spfrReturnTripFixture } from './fixtures/spfr-return-trip';

/**
 * REG-01(T-04): 원천 자신의 하루 모델(SP-FR build/model.py `load_days`)과 변환 값의 비교.
 *
 *   regions  = checkin <= 날짜 <= checkout 인 숙박의 key (checkout 날짜 포함 → 이동일이면 출발·도착 둘)
 *   sleeping = checkin <= 날짜 <  checkout 인 숙박 (그날 밤을 자는 곳)
 *
 * 기대값은 이 파일 안의 독립 함수로 계산한다(변환 helper를 쓰지 않는다). T-03에서는 환경변수 gate 아래의
 * 실패 재현이었고, 수정 뒤에는 일반 검사에서 항상 실행된다. 가상 fixture만 읽는다.
 * 원천의 `return` 센티널과 종료 숙박 폴백은 따르지 않는다: 숙박이 닿지 않는 날은 지역이 없다.
 */
type Stay = { key: string; checkin: string; checkout: string; base?: string; nights?: number };
type RegionDay = { regionIds: string[]; overnightRegionId?: string };

function sourceModelRegions(stays: Stay[], date: string) {
  return [...new Set(stays.filter((stay) => stay.checkin <= date && date <= stay.checkout).map((stay) => stay.key))];
}

function sleepingRegion(stays: Stay[], date: string) {
  return stays.filter((stay) => stay.checkin <= date && date < stay.checkout).at(-1)?.key;
}

async function convertedDays(replaceStays?: Stay[]) {
  const fixture = await spfrReturnTripFixture('unknown');
  const itinerary = fixture.extract.entries.find(
    (entry) => entry.sourceKey === 'source/CURRENT/10_Core/itinerary.json',
  )!;
  if (replaceStays) {
    (itinerary.rawValue as { stays: Stay[] }).stays = replaceStays;
  }
  const result = await normalizeSpfrPilot(fixture.extract, fixture.options);
  expect(result.report.blocking).toEqual([]);
  const stays = (itinerary.rawValue as { stays: Stay[] }).stays;
  return { stays, days: result.dataset.plans[0].days, result };
}

function regionsByDay(days: ({ dayId: string } & RegionDay)[]) {
  return Object.fromEntries(days.map((day) => [day.dayId, [day.regionIds, day.overnightRegionId]]));
}

const home = { key: 'fiction', base: '가상 숙소' };
const away = { key: 'other', base: '가상 다른 숙소' };

describe('REG-01 · 원천 하루 모델 대비 day.regionIds / overnightRegionId', () => {
  it('이동일(day-30)은 출발·도착 지역을 모두 가진다', async () => {
    const { stays, days } = await convertedDays();
    const day = days.find((value) => value.dayId === 'day-30')!;
    expect(sourceModelRegions(stays, day.date)).toEqual(['fiction', 'other']);
    expect(day.regionIds).toEqual(['fiction', 'other']);
    expect(day.overnightRegionId).toBe('other');
  });

  it('숙박 종료일(day-31, 새 숙박 없음)은 종료되는 숙박의 지역을 가지고 야간 지역은 없다', async () => {
    const { stays, days } = await convertedDays();
    const day = days.find((value) => value.dayId === 'day-31')!;
    expect(sourceModelRegions(stays, day.date)).toEqual(['other']);
    expect(day.regionIds).toEqual(['other']);
    expect(day.overnightRegionId).toBeUndefined();
  });

  it('모든 날의 지역과 야간 지역이 독립 계산과 같다', async () => {
    const { stays, days } = await convertedDays();
    for (const day of days) {
      expect(day.overnightRegionId).toBe(sleepingRegion(stays, day.date));
      expect(day.regionIds).toEqual(sourceModelRegions(stays, day.date));
    }
  });

  it('숙박이 전혀 닿지 않는 날은 지역도 야간 지역도 없고 이웃 날의 지역을 상속하지 않는다', async () => {
    // 두 번째 숙박을 없애면 day-31에 닿는 숙박이 없다. 활동 장소 지역(other)이 있어도 날의 지역은 만들지 않는다.
    const { days } = await convertedDays([{ ...home, checkin: '2033-05-01', checkout: '2033-05-03', nights: 2 }]);
    expect(regionsByDay(days)).toEqual({
      'day-28': [['fiction'], 'fiction'],
      'day-29': [['fiction'], 'fiction'],
      'day-30': [['fiction'], undefined],
      'day-31': [[], undefined],
    });
  });

  it('같은 지역에 다시 묵는 여행은 지역을 중복 없이 숙박 순서대로 담고 야간 지역은 마지막 숙박이다', async () => {
    const { days } = await convertedDays([
      { ...home, checkin: '2033-05-01', checkout: '2033-05-02', nights: 1 },
      { ...away, checkin: '2033-05-02', checkout: '2033-05-03', nights: 1 },
      { ...home, checkin: '2033-05-03', checkout: '2033-05-04', nights: 1 },
    ]);
    expect(regionsByDay(days)).toEqual({
      'day-28': [['fiction'], 'fiction'],
      'day-29': [['fiction', 'other'], 'other'],
      'day-30': [['other', 'fiction'], 'fiction'],
      'day-31': [['fiction'], undefined],
    });
  });

  it('잘못된 숙박 값(체크아웃이 체크인보다 앞섬)은 조용히 넘기지 않고 변환을 거부한다', async () => {
    await expect(
      convertedDays([{ ...home, checkin: '2033-05-03', checkout: '2033-05-01', nights: 2 }]),
    ).rejects.toThrow('숙박 원천 값이 올바르지 않습니다.');
  });

  it('지역 콘텐츠는 날에 닿는 모든 지역(종료일 포함)에 대해 존재한다', async () => {
    const { days, result } = await convertedDays();
    const regions = new Set(
      result.dataset.contents.filter((content) => content.kind === 'region').map((content) => content.entityId),
    );
    for (const day of days) {
      for (const regionId of day.regionIds) {
        expect(regions.has(regionId)).toBe(true);
      }
    }
  });
});
