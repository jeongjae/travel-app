import { describe, expect, it } from 'vitest';
import { tripHeaderSchema } from '../src/contracts/v2/index';
import { buildNewTrip, NewTripError } from '../src/content/trip-factory';

describe('buildNewTrip · 지역 없는 새 여행', () => {
  it('기간의 날짜마다 콘텐츠 참조 없는 날짜 행을 만든다', () => {
    const trip = buildNewTrip({ name: ' 가상 여행 ', start: '2032-02-27', end: '2032-03-01' });
    expect(trip.header.name).toBe('가상 여행');
    expect(trip.header.timeZoneStatus).toBe('unknown');
    expect(trip.header.defaultTimeZone).toBeUndefined();
    expect(tripHeaderSchema.safeParse(trip.header).success).toBe(true);
    expect(trip.initialPlan.days.map((day) => day.date)).toEqual([
      '2032-02-27',
      '2032-02-28',
      '2032-02-29',
      '2032-03-01',
    ]);
    for (const day of trip.initialPlan.days) {
      expect(day.regionIds).toEqual([]);
      expect(day.overnightRegionId).toBeUndefined();
    }
    expect(trip.initialPlan.items).toEqual([]);
    expect(trip.initialPlan.stays).toEqual([]);
  });

  it('확인한 시간대만 확인됨으로 저장한다', () => {
    const trip = buildNewTrip({ name: 'a', start: '2032-04-01', end: '2032-04-01', timeZone: 'Europe/Paris' });
    expect(trip.header).toMatchObject({ defaultTimeZone: 'Europe/Paris', timeZoneStatus: 'confirmed' });
    expect(tripHeaderSchema.safeParse(trip.header).success).toBe(true);
  });

  it.each([
    [{ name: '  ', start: '2032-04-01', end: '2032-04-02' }, '이름'],
    [{ name: 'a', start: '2031-02-30', end: '2031-03-02' }, '실제 달력'],
    [{ name: 'a', start: '2032-04-03', end: '2032-04-02' }, '이릅니다'],
    [{ name: 'a', start: '2032-04-01', end: '2032-04-02', timeZone: 'Mars/Base' }, '시간대'],
    [{ name: 'a', start: '2032-04-01', end: '2045-04-02' }, '한도'],
    [{ name: 'a', start: '', end: '2032-04-02' }, '날짜로'],
  ])('잘못된 입력은 거부한다 %#', (input, message) => {
    expect(() => buildNewTrip(input)).toThrow(NewTripError);
    expect(() => buildNewTrip(input)).toThrow(message);
  });
});
