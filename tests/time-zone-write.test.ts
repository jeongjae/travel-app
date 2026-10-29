import { describe, expect, it } from 'vitest';
import { timeSpecSchema, validateCommand, isKnownTimeZone, validateTripDataset } from '../src/contracts/v2/index';
import { pilotTrip } from './fixtures/pilot';

/** C-02 / CL-05: 새 수동 쓰기는 플랫폼이 아는 IANA 시간대만 받고, 이미 저장된 자료 읽기는 막지 않는다. */
const changePlan = async (zone: string) => {
  const trip = await pilotTrip();
  const plan = trip.plans[0];
  const item = {
    ...plan.items[0],
    time: {
      start: {
        precision: 'local',
        date: plan.days[0].date,
        localTime: '09:00',
        timeZone: zone,
        timeZoneStatus: 'confirmed',
      },
    },
  };
  return {
    format: 'travel-app-command',
    commandVersion: 2,
    normalizationVersion: 'c02',
    tripId: trip.header.tripId,
    requestId: 'request-1',
    kind: 'ChangePlan',
    expectedDomainRevision: trip.header.domainRevision,
    payload: {
      currentPlanVersionId: plan.planVersionId,
      operations: [{ type: 'upsert-item', item }],
      reason: '시간대',
    },
  };
};

describe('시간대 검증 (CL-05)', () => {
  it.each(['Mars/Base', 'Europe/Nowhere', '', '+09:00', 'Seoul'])(
    '알 수 없는 시간대 %j는 새 쓰기에서 거부한다',
    async (zone) => {
      expect(isKnownTimeZone(zone)).toBe(false);
      await expect(async () => validateCommand(await changePlan(zone))).rejects.toThrow();
    },
  );

  it.each(['Asia/Seoul', 'Europe/Paris', 'UTC', 'Asia/Calcutta', 'America/New_York', 'Etc/GMT+9'])(
    '유효한 IANA 시간대 %s는 받는다',
    async (zone) => {
      expect(isKnownTimeZone(zone)).toBe(true);
      expect(validateCommand(await changePlan(zone)).kind).toBe('ChangePlan');
    },
  );

  it('시작/종료 역전은 새 쓰기에서 거부한다 (같은 시간대·같은 날 현지 시각, 날짜 역전)', async () => {
    const base = await changePlan('Asia/Seoul');
    const time = (start: unknown, end: unknown) => ({
      ...base,
      payload: {
        ...base.payload,
        operations: [
          {
            type: 'upsert-item',
            item: { ...(base.payload.operations[0] as { item: object }).item, time: { start, end } },
          },
        ],
      },
    });
    const local = (date: string, localTime: string) => ({
      precision: 'local',
      date,
      localTime,
      timeZone: 'Asia/Seoul',
      timeZoneStatus: 'confirmed',
    });
    expect(() => validateCommand(time(local('2033-05-01', '10:00'), local('2033-05-01', '09:00')))).toThrow('종료');
    expect(() =>
      validateCommand(time({ precision: 'date', date: '2033-05-02' }, { precision: 'date', date: '2033-05-01' })),
    ).toThrow('종료');
    expect(validateCommand(time(local('2033-05-01', '10:00'), local('2033-05-01', '10:00'))).kind).toBe('ChangePlan');
    expect(validateCommand(time(local('2033-05-01', '23:00'), local('2033-05-02', '01:00'))).kind).toBe('ChangePlan');
    // 시간대가 다르거나 확인되지 않은 쪽은 비교하지 않는다(자동 변환·추정 금지).
    expect(
      validateCommand(
        time(local('2033-05-01', '10:00'), {
          precision: 'local',
          date: '2033-05-01',
          localTime: '09:00',
          timeZoneStatus: 'unknown',
        }),
      ).kind,
    ).toBe('ChangePlan');
  });

  it('이미 저장된 자료의 역전된 시간 범위는 읽기에서 다시 판정하지 않는다', async () => {
    const trip = await pilotTrip();
    const day = trip.plans[0].days[0].date;
    const local = (localTime: string) => ({
      precision: 'local' as const,
      date: day,
      localTime,
      timeZone: 'Asia/Seoul',
      timeZoneStatus: 'confirmed' as const,
    });
    trip.plans[0].items[0].time = { start: local('10:00'), end: local('09:00') };
    expect(() => validateTripDataset(trip)).not.toThrow();
  });

  it('시간대 확인 상태와 값이 어긋나면 거부하고, 날짜 정밀도는 시간대를 발명하지 않는다', () => {
    expect(
      timeSpecSchema.safeParse({
        precision: 'local',
        date: '2033-05-01',
        localTime: '09:00',
        timeZoneStatus: 'confirmed',
      }).success,
    ).toBe(false);
    expect(
      timeSpecSchema.safeParse({
        precision: 'local',
        date: '2033-05-01',
        localTime: '09:00',
        timeZoneStatus: 'unknown',
      }).success,
    ).toBe(true);
    expect(timeSpecSchema.safeParse({ precision: 'date', date: '2033-05-01' }).success).toBe(true);
  });

  it('DST 건너뛴 시각은 거부하고 겹친 시각은 하나의 instant로 확정하지 않는다', () => {
    const local = (localTime: string, date: string) => ({
      precision: 'local',
      date,
      localTime,
      timeZone: 'Europe/Paris',
      timeZoneStatus: 'confirmed',
    });
    expect(timeSpecSchema.safeParse(local('02:30', '2033-03-27')).success).toBe(false);
    expect(timeSpecSchema.safeParse(local('02:30', '2033-10-30')).success).toBe(true);
    const instant = (offset: string, iso: string) => ({
      precision: 'instant',
      date: '2033-10-30',
      localTime: '02:30',
      timeZone: 'Europe/Paris',
      offset,
      instant: iso,
    });
    expect(timeSpecSchema.safeParse(instant('+02:00', '2033-10-30T00:30:00Z')).success).toBe(true);
    expect(timeSpecSchema.safeParse(instant('+01:00', '2033-10-30T01:30:00Z')).success).toBe(true);
    expect(timeSpecSchema.safeParse(instant('+01:00', '2033-10-30T00:30:00Z')).success).toBe(false);
  });
});
