import { Temporal } from '@js-temporal/polyfill';
import { timeZone as timeZoneSchema, type PlanVersion, type TripDataset } from '../contracts/v2/index';

export const MAX_TRIP_DAYS = 3660;

export type NewTripInput = { name: string; start: string; end: string; timeZone?: string };

export class NewTripError extends Error {}

function knownTimeZone(value: string) {
  try {
    // The shared schema accepts names the polyfill cannot resolve, so confirm with the platform database too.
    new Intl.DateTimeFormat('en', { timeZone: value });
    return timeZoneSchema.safeParse(value).success;
  } catch {
    return false;
  }
}

function calendarDate(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new NewTripError(`${label}을 날짜로 입력하세요.`);
  }
  try {
    return Temporal.PlainDate.from(value, { overflow: 'reject' });
  } catch {
    throw new NewTripError(`${label}이 실제 달력에 없는 날짜입니다.`);
  }
}

/**
 * 지역·장소·숙박 없이 날짜만 있는 새 여행의 헤더와 첫 계획을 만든다.
 * 날짜 행은 콘텐츠 참조 없이 regionIds=[], 야간 지역 미설정이다. 시간대는 사용자가 확인한 값만 저장한다.
 */
export function buildNewTrip(input: NewTripInput): {
  tripId: string;
  header: TripDataset['header'];
  initialPlan: Omit<PlanVersion, 'commitSeq' | 'createdAt'>;
} {
  const name = input.name.trim();
  if (!name) {
    throw new NewTripError('여행 이름을 입력하세요.');
  }
  const first = calendarDate(input.start, '시작 날짜');
  const last = calendarDate(input.end, '종료 날짜');
  if (Temporal.PlainDate.compare(last, first) < 0) {
    throw new NewTripError('종료 날짜가 시작 날짜보다 이릅니다. 기간을 확인하세요.');
  }
  const zone = input.timeZone?.trim();
  if (zone && !knownTimeZone(zone)) {
    throw new NewTripError('알 수 없는 시간대입니다. 예: Europe/Paris');
  }
  const dayCount = first.until(last, { largestUnit: 'days' }).days + 1;
  if (dayCount > MAX_TRIP_DAYS) {
    throw new NewTripError(`여행 날짜 수 한도는 ${MAX_TRIP_DAYS}일입니다.`);
  }
  const tripId = crypto.randomUUID();
  const planVersionId = crypto.randomUUID();
  const days: PlanVersion['days'] = [];
  for (let offset = 0; offset < dayCount; offset++) {
    const date = first.add({ days: offset }).toString();
    days.push({
      tripId,
      planVersionId,
      dayId: crypto.randomUUID(),
      ordinal: offset + 1,
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
    });
  }
  return {
    tripId,
    header: {
      tripId,
      name,
      startDate: first.toString(),
      endDate: last.toString(),
      ...(zone
        ? { defaultTimeZone: zone, timeZoneStatus: 'confirmed' as const }
        : { timeZoneStatus: 'unknown' as const }),
      domainRevision: 0,
      currentPlanVersionId: planVersionId,
    },
    initialPlan: {
      tripId,
      planVersionId,
      number: 1,
      reason: '새 여행',
      contextRefs: [],
      days,
      items: [],
      legs: [],
      stays: [],
    },
  };
}
