import { describe, expect, it } from 'vitest';
import { stayRegionsForDay, validateSourceStays } from '../src/transfer/spfr-stays';

const stay = (key: string, checkin: string, checkout: string) => ({ key, checkin, checkout });

describe('spfr-stays · 날짜별 지역 계산', () => {
  const stays = [stay('a', '2033-01-01', '2033-01-03'), stay('b', '2033-01-03', '2033-01-04')];

  it('이동일은 출발·도착을 숙박 순서로, 야간 지역은 도착으로 한다', () => {
    expect(stayRegionsForDay(stays, '2033-01-03')).toEqual({ regionIds: ['a', 'b'], overnightRegionId: 'b' });
  });

  it('숙박 종료일은 종료 지역만 담고 야간 지역은 비운다', () => {
    expect(stayRegionsForDay(stays, '2033-01-04')).toEqual({ regionIds: ['b'] });
  });

  it('숙박이 닿지 않는 날은 비어 있다', () => {
    expect(stayRegionsForDay(stays, '2033-01-05')).toEqual({ regionIds: [] });
    expect(stayRegionsForDay(stays, '2032-12-31')).toEqual({ regionIds: [] });
  });

  it('원천 순서가 날짜 순서가 아니어도 야간 지역은 원천 순서의 마지막이다', () => {
    const shuffled = [stays[1], stays[0]];
    expect(stayRegionsForDay(shuffled, '2033-01-03')).toEqual({ regionIds: ['b', 'a'], overnightRegionId: 'b' });
  });

  it('0박 숙박은 지역에는 닿지만 야간 지역이 되지 않는다', () => {
    expect(stayRegionsForDay([stay('z', '2033-01-02', '2033-01-02')], '2033-01-02')).toEqual({ regionIds: ['z'] });
  });

  it.each([
    [stay('', '2033-01-01', '2033-01-02')],
    [stay('a', '2033-1-1', '2033-01-02')],
    [stay('a', '2033-01-02', '2033-01-01')],
  ])('잘못된 숙박 값은 거부한다 %#', (invalid) => {
    expect(() => validateSourceStays([invalid])).toThrow('숙박 원천 값이 올바르지 않습니다.');
  });
});
