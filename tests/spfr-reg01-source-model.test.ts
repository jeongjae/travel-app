import { describe, expect, it } from 'vitest';
import { normalizeSpfrPilot } from '../src/transfer/spfr-pilot';
import { spfrReturnTripFixture } from './fixtures/spfr-return-trip';

/**
 * REG-01 재현(T-03c): 원천 자신의 하루 모델(SP-FR build/model.py `load_days`)과 현재 변환 값의 비교.
 *
 *   regions  = checkin <= 날짜 <= checkout 인 숙박의 key (checkout 날짜 포함 → 이동일이면 출발·도착 둘)
 *   sleeping = checkin <= 날짜 <  checkout 인 숙박 (그날 밤을 자는 곳)
 *
 * 현재 변환은 `날짜 < checkout`만 쓰므로 이동일의 출발 지역과 숙박 종료일의 지역이 day.regionIds에서 빠진다.
 * 이것은 제품 결함 후보의 재현이다. 기본 검사(`pnpm run test`)에서는 건너뛰고 환경변수가 있을 때만 실행한다.
 *   T03_REG01_REPRO=1 pnpm exec vitest run tests/spfr-reg01-source-model.test.ts
 * 판정(A/B/원천 모델 채택)과 제품 수정은 Codex 지시 뒤에 한다. 이 파일의 기대값을 약화해 통과시키지 않는다.
 */
const enabled = process.env.T03_REG01_REPRO === '1';

type Stay = { key: string; checkin: string; checkout: string };

function sourceModelRegions(stays: Stay[], date: string) {
  return stays.filter((stay) => stay.checkin <= date && date <= stay.checkout).map((stay) => stay.key);
}

function sleepingRegion(stays: Stay[], date: string) {
  return stays.filter((stay) => stay.checkin <= date && date < stay.checkout).at(-1)?.key;
}

async function convertedDays() {
  const fixture = await spfrReturnTripFixture('unknown');
  const result = await normalizeSpfrPilot(fixture.extract, fixture.options);
  expect(result.report.blocking).toEqual([]);
  const itinerary = fixture.extract.entries.find(
    (entry) => entry.sourceKey === 'source/CURRENT/10_Core/itinerary.json',
  );
  const stays = (itinerary!.rawValue as { stays: Stay[] }).stays;
  return { stays, days: result.dataset.plans[0].days };
}

describe.skipIf(!enabled)('[REG-01 재현] 원천 하루 모델 대비 day.regionIds', () => {
  it('이동일(day-30)은 출발·도착 지역을 모두 가진다', async () => {
    const { stays, days } = await convertedDays();
    const day = days.find((value) => value.dayId === 'day-30')!;
    expect(sourceModelRegions(stays, day.date)).toEqual(['fiction', 'other']);
    expect(day.regionIds).toEqual(['fiction', 'other']);
  });

  it('숙박 종료일(day-31, 새 숙박 없음)은 종료되는 숙박의 지역을 가진다', async () => {
    const { stays, days } = await convertedDays();
    const day = days.find((value) => value.dayId === 'day-31')!;
    expect(sourceModelRegions(stays, day.date)).toEqual(['other']);
    expect(day.regionIds).toEqual(['other']);
  });

  // 어떤 판정을 택해도 지켜야 하는 보호선: 그날 밤을 자는 지역만 overnightRegionId가 된다.
  it('overnightRegionId는 그날 밤 자는 숙박의 지역이고 없으면 비어 있다', async () => {
    const { stays, days } = await convertedDays();
    for (const day of days) {
      expect(day.overnightRegionId).toBe(sleepingRegion(stays, day.date));
    }
  });
});
