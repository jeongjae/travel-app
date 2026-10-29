import { Temporal } from '@js-temporal/polyfill';
import type { PlanVersion, TimeSpec } from '../contracts/v2/index';

/**
 * 사용자가 직접 입력한 숙박의 날짜·지역 계산. SP-FR 원천 변환 규칙(`transfer/spfr-stays.ts`)과 분리돼 있으며
 * 가져온 날을 일괄 재계산하는 데 쓰지 않는다. 계획 편집에서 숙박이 닿는 날짜에만 호출한다.
 *
 *   하루 지역   = 입실일 <= 날짜 <= 퇴실일 인 숙박의 지역 (퇴실일 포함, 원래 순서·중복 제거)
 *   야간 지역   = 입실일 <= 날짜 <  퇴실일 인 숙박의 지역 (그날 밤 자는 곳)
 *   같은 밤에 서로 다른 지역이 겹치면 고르지 않고 문제로 돌려준다.
 *   지역이 없는 숙박은 지역·야간 지역을 만들지 않는다. 방문 장소의 지역은 쓰지 않는다.
 */
type Stay = PlanVersion['stays'][number];
export type StayRange = { checkin: string; checkout: string };
export type Problem = { problem: string };

function zone(spec: TimeSpec) {
  if (spec.precision === 'instant') {
    return spec.timeZone;
  }
  return spec.precision === 'local' ? spec.timeZone : undefined;
}

/** 입실/퇴실 날짜. 날짜가 없거나 역전되거나 시간대가 서로 달라 날짜 대응이 모호하면 문제를 돌려준다. */
export function stayRange(stay: Pick<Stay, 'time' | 'plannedNights'>): StayRange | Problem {
  const checkin = stay.time.start.date;
  const checkout = stay.time.end?.date;
  if (!checkin || !checkout) {
    return { problem: '입실 날짜와 퇴실 날짜를 모두 입력하세요.' };
  }
  if (checkout < checkin) {
    return { problem: '퇴실 날짜가 입실 날짜보다 이릅니다.' };
  }
  const startZone = zone(stay.time.start);
  const endZone = zone(stay.time.end!);
  if (startZone && endZone && startZone !== endZone) {
    return {
      problem: `입실(${startZone})과 퇴실(${endZone})의 시간대가 달라 날짜 대응이 모호합니다. 같은 시간대로 맞추거나 날짜만 입력하세요.`,
    };
  }
  const nights = Temporal.PlainDate.from(checkin).until(Temporal.PlainDate.from(checkout), {
    largestUnit: 'days',
  }).days;
  if (stay.plannedNights !== undefined && stay.plannedNights !== nights) {
    return { problem: `박수(${stay.plannedNights})가 입실·퇴실 날짜의 차이(${nights}박)와 다릅니다.` };
  }
  return { checkin, checkout };
}

export const isProblem = (value: object): value is Problem => 'problem' in value;

/** 날짜 하나의 하루 지역·야간 지역. 날짜를 읽을 수 없는 숙박(원천 일부)은 건너뛴다. */
export function dayRegionsFromStays(
  stays: Pick<Stay, 'stayId' | 'regionId' | 'time' | 'plannedNights'>[],
  date: string,
): { regionIds: string[]; overnightRegionId?: string } | Problem {
  const regionIds: string[] = [];
  const overnight = new Set<string>();
  for (const stay of stays) {
    if (!stay.regionId) {
      continue;
    }
    const range = stayRange(stay);
    if (isProblem(range)) {
      continue;
    }
    if (range.checkin <= date && date <= range.checkout && !regionIds.includes(stay.regionId)) {
      regionIds.push(stay.regionId);
    }
    if (range.checkin <= date && date < range.checkout) {
      overnight.add(stay.regionId);
    }
  }
  if (overnight.size > 1) {
    return {
      problem: `${date} 밤에 서로 다른 지역의 숙박이 겹칩니다(${[...overnight].join(', ')}). 숙박 기간을 조정하세요.`,
    };
  }
  const [overnightRegionId] = overnight;
  return { regionIds, ...(overnightRegionId ? { overnightRegionId } : {}) };
}
