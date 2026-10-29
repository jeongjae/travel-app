import { describe, expect, it } from 'vitest';
import { dayRegionsFromStays, isProblem, stayRange } from '../src/plan/manual-stays';

/** C-02: 수동 숙박의 날짜·지역 계산은 이 파일의 독립 기대값으로 검사한다(SP-FR 변환 helper를 쓰지 않는다). */
type Time =
  | { precision: 'date'; date: string }
  | { precision: 'local'; date: string; localTime: string; timeZone?: string; timeZoneStatus: 'confirmed' | 'unknown' };
const day = (date: string): Time => ({ precision: 'date', date });
const stay = (stayId: string, regionId: string | undefined, checkin: string, checkout: string, extra = {}) => ({
  stayId,
  ...(regionId ? { regionId } : {}),
  time: { start: day(checkin), end: day(checkout) },
  ...extra,
});
const at = (date: string, zone?: string): Time => ({
  precision: 'local',
  date,
  localTime: '15:00',
  ...(zone ? { timeZone: zone, timeZoneStatus: 'confirmed' as const } : { timeZoneStatus: 'unknown' as const }),
});

describe('stayRange', () => {
  it('날짜가 없거나 역전되면 문제를 돌려준다', () => {
    expect(stayRange({ time: { start: { precision: 'unspecified' } } })).toHaveProperty('problem');
    expect(stayRange({ time: { start: day('2033-05-01') } })).toHaveProperty('problem');
    expect(stayRange({ time: { start: day('2033-05-03'), end: day('2033-05-01') } })).toMatchObject({
      problem: expect.stringContaining('이릅니다'),
    });
  });

  it('박수가 날짜 차이와 다르면 문제, 같으면 통과한다', () => {
    const time = { start: day('2033-05-01'), end: day('2033-05-03') };
    expect(stayRange({ time, plannedNights: 3 })).toHaveProperty('problem');
    expect(stayRange({ time, plannedNights: 2 })).toEqual({ checkin: '2033-05-01', checkout: '2033-05-03' });
  });

  it('입실·퇴실의 시간대가 서로 다르면 날짜 대응이 모호하다고 돌려주고, 같은 시간대·날짜만 입력은 통과한다', () => {
    expect(
      stayRange({ time: { start: at('2033-05-01', 'Europe/Paris'), end: at('2033-05-03', 'Asia/Seoul') } }),
    ).toMatchObject({ problem: expect.stringContaining('모호') });
    expect(
      stayRange({ time: { start: at('2033-05-01', 'Europe/Paris'), end: at('2033-05-03', 'Europe/Paris') } }),
    ).toEqual({ checkin: '2033-05-01', checkout: '2033-05-03' });
    expect(stayRange({ time: { start: at('2033-05-01'), end: at('2033-05-03', 'Asia/Seoul') } })).toEqual({
      checkin: '2033-05-01',
      checkout: '2033-05-03',
    });
  });
});

describe('dayRegionsFromStays', () => {
  const one = [stay('s1', 'a', '2033-05-01', '2033-05-03')];

  it('퇴실일은 하루 지역에 포함하되 야간 지역에서는 제외한다', () => {
    expect(dayRegionsFromStays(one, '2033-05-01')).toEqual({ regionIds: ['a'], overnightRegionId: 'a' });
    expect(dayRegionsFromStays(one, '2033-05-02')).toEqual({ regionIds: ['a'], overnightRegionId: 'a' });
    expect(dayRegionsFromStays(one, '2033-05-03')).toEqual({ regionIds: ['a'] });
  });

  it('숙박이 닿지 않는 날은 비어 있다', () => {
    expect(dayRegionsFromStays(one, '2033-04-30')).toEqual({ regionIds: [] });
    expect(dayRegionsFromStays(one, '2033-05-04')).toEqual({ regionIds: [] });
    expect(dayRegionsFromStays([], '2033-05-01')).toEqual({ regionIds: [] });
  });

  it('이동일은 두 지역을 숙박 순서로 담고 야간 지역은 도착이다', () => {
    const moved = [...one, stay('s2', 'b', '2033-05-03', '2033-05-04')];
    expect(dayRegionsFromStays(moved, '2033-05-03')).toEqual({ regionIds: ['a', 'b'], overnightRegionId: 'b' });
    expect(dayRegionsFromStays(moved, '2033-05-04')).toEqual({ regionIds: ['b'] });
  });

  it('0박은 하루 지역에만 포함하고 야간 지역을 만들지 않는다', () => {
    expect(dayRegionsFromStays([stay('z', 'z', '2033-05-02', '2033-05-02')], '2033-05-02')).toEqual({
      regionIds: ['z'],
    });
  });

  it('같은 지역을 다시 묵으면 중복 없이 숙박 순서를 지킨다', () => {
    const stays = [
      stay('s1', 'a', '2033-05-01', '2033-05-02'),
      stay('s2', 'b', '2033-05-02', '2033-05-03'),
      stay('s3', 'a', '2033-05-03', '2033-05-04'),
    ];
    expect(dayRegionsFromStays(stays, '2033-05-03')).toEqual({ regionIds: ['b', 'a'], overnightRegionId: 'a' });
  });

  it('같은 밤에 서로 다른 지역이 겹치면 고르지 않고 문제를 돌려준다. 같은 지역 겹침은 허용한다', () => {
    const overlap = [stay('s1', 'a', '2033-05-01', '2033-05-03'), stay('s2', 'b', '2033-05-02', '2033-05-04')];
    expect(dayRegionsFromStays(overlap, '2033-05-02')).toMatchObject({ problem: expect.stringContaining('겹칩니다') });
    expect(dayRegionsFromStays(overlap, '2033-05-01')).toEqual({ regionIds: ['a'], overnightRegionId: 'a' });
    const sameRegion = [stay('s1', 'a', '2033-05-01', '2033-05-03'), stay('s2', 'a', '2033-05-02', '2033-05-04')];
    expect(dayRegionsFromStays(sameRegion, '2033-05-02')).toEqual({ regionIds: ['a'], overnightRegionId: 'a' });
  });

  it('지역이 없는 숙박과 날짜를 읽을 수 없는 숙박은 지역·야간 지역을 만들지 않는다', () => {
    expect(dayRegionsFromStays([stay('s1', undefined, '2033-05-01', '2033-05-03')], '2033-05-02')).toEqual({
      regionIds: [],
    });
    expect(
      dayRegionsFromStays(
        [{ stayId: 'x', regionId: 'a', time: { start: { precision: 'unspecified' as const } } }],
        '2033-05-02',
      ),
    ).toEqual({ regionIds: [] });
  });

  it('isProblem은 문제 객체만 가려낸다', () => {
    expect(isProblem({ problem: 'x' })).toBe(true);
    expect(isProblem({ regionIds: [] })).toBe(false);
  });
});
