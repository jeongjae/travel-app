import { Temporal } from '@js-temporal/polyfill';
import type { TimeSpec, TripDataset } from '../contracts/v2';

type TripHeader = Pick<TripDataset['header'], 'defaultTimeZone' | 'timeZoneStatus'>;

/** 여행에 확인된 시간대가 있을 때만 그 값을 돌려준다. 확인되지 않았으면 undefined. */
export function confirmedZone(header: TripHeader) {
  return header.timeZoneStatus === 'confirmed' ? header.defaultTimeZone : undefined;
}

/** 기기 시계의 지금을 여행 시간대의 날짜·분 단위 시각으로 바꾼다. 시간대가 확인되지 않았으면 undefined. */
export function nowInTripZone(header: TripHeader, clock: Temporal.Instant = Temporal.Now.instant()) {
  const zone = confirmedZone(header);
  if (!zone) {
    return undefined;
  }
  const zoned = clock.toZonedDateTimeISO(zone);
  return {
    zone,
    date: zoned.toPlainDate().toString(),
    clock: zoned.toPlainTime().toString({ smallestUnit: 'minute' }),
  };
}

/** 방문 기록 한 번 누르기: 지금 시각을 여행 시간대의 현지 시각으로 만든다. */
export function visitNowTime(header: TripHeader, clock?: Temporal.Instant): TimeSpec | undefined {
  const now = nowInTripZone(header, clock);
  if (!now) {
    return undefined;
  }
  return { precision: 'local', date: now.date, localTime: now.clock, timeZone: now.zone, timeZoneStatus: 'confirmed' };
}

/**
 * 기록 폼의 시작값. 날짜는 보고 있는 날짜, 시각은 그 날짜가 오늘일 때만 지금 시각이다.
 * 지난 날을 보며 기록할 때 지금 시각을 넣으면 사실과 다르므로 날짜만 채운다.
 */
export function recordFormDefault(
  header: TripHeader,
  viewDate: string | undefined,
  clock?: Temporal.Instant,
): TimeSpec {
  const now = nowInTripZone(header, clock);
  if (now && (!viewDate || viewDate === now.date)) {
    return visitNowTime(header, clock)!;
  }
  if (viewDate) {
    return { precision: 'date', date: viewDate };
  }
  return { precision: 'unspecified' };
}

export function nextDay(date: string) {
  return Temporal.PlainDate.from(date).add({ days: 1 }).toString();
}
