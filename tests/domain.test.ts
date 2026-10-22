import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TravelDB, TravelRepository } from '../src/repository';
import {
  currentPlan,
  effectiveActuals,
  fromLocal,
  localDate,
  localInput,
  newTrip,
  now,
  uid,
  validateTrip,
  type Activity,
  type ProposalInput,
  type Trip,
} from '../src/domain';
import { convertLegacy, parseFile } from '../src/import-export';

let repo: TravelRepository;
let trip: Trip;
const activity = (overrides: Partial<Activity> = {}): Activity => ({
  id: 'walk',
  title: '강변 산책',
  start: fromLocal('2026-11-07T11:00', 'Europe/Paris'),
  end: fromLocal('2026-11-07T12:00', 'Europe/Paris'),
  timeZone: 'Europe/Paris',
  note: '',
  ...overrides,
});
const actualInput = () => ({
  activityId: 'walk',
  title: '강변 산책',
  start: activity().start,
  end: activity().end,
  timeZone: 'Europe/Paris',
  note: '현장 기록',
  outcome: 'skipped' as const,
});
const proposal = (t: Trip): ProposalInput => ({
  id: uid(),
  tripId: t.id,
  baseRevision: t.revision,
  reason: '비 예보로 실내 일정으로 수정',
  reservationImpact: '예약 영향 없음',
  evidence: [
    {
      id: 'source',
      source: 'https://example.org/research',
      claim: '테스트용 가상 근거 (실제 조사 아님)',
      checkedAt: now(),
      appliesFrom: t.startDate,
      appliesTo: t.endDate,
      relatedActivityIds: ['walk'],
      status: 'unverified',
    },
  ],
  operations: [{ type: 'upsert', activity: activity({ title: '도서관' }) }],
});
beforeEach(async () => {
  repo = new TravelRepository(new TravelDB(`test-${uid()}`));
  trip = await repo.create({
    name: '파리 가상 여행',
    startDate: '2026-11-07',
    endDate: '2026-11-09',
    timeZone: 'Europe/Paris',
  });
  trip = await repo.changePlan(trip.id, 0, [{ type: 'upsert', activity: activity() }], '초기 일정');
});
afterEach(async () => {
  await repo.db.delete();
});

describe('여행과 변경안 저장 경계', () => {
  it('계획 적용 후 실제 기록·이전 버전·근거·결정이 보존되고 재실행으로 복원된다', async () => {
    trip = await repo.record(trip.id, trip.revision, actualInput());
    const originals = structuredClone(trip.actuals);
    const p = proposal(trip);
    trip = await repo.propose(p);
    expect(currentPlan(trip).activities[0].title).toBe('강변 산책');
    trip = await repo.decide(trip.id, p.id, 'apply');
    expect(currentPlan(trip).activities[0].title).toBe('도서관');
    expect(trip.actuals).toEqual(originals);
    expect(trip.versions[1].activities[0].title).toBe('강변 산책');
    expect(currentPlan(trip).evidence[0].status).toBe('unverified');
    expect(trip.proposals[0]).toMatchObject({ status: 'applied', decidedBy: 'user', basePlanNumber: 2 });
    repo.db.close();
    await repo.db.open();
    expect(await repo.get(trip.id)).toEqual(trip);
  });
  it('다른 여행의 일정과 기록을 격리한다', async () => {
    const b = await repo.create({
      name: '서울',
      startDate: '2026-11-07',
      endDate: '2026-11-09',
      timeZone: 'Asia/Seoul',
    });
    await repo.record(trip.id, trip.revision, actualInput());
    expect(await repo.get(b.id)).toEqual(b);
    await expect(repo.record(b.id, b.revision, actualInput())).rejects.toThrow('원본 일정');
    const wrong = {
      ...proposal(trip),
      tripId: b.id,
      baseRevision: b.revision,
      operations: [{ type: 'remove' as const, activityId: 'walk' }],
    };
    await expect(repo.propose(wrong)).rejects.toThrow('현재 계획');
    expect(await repo.get(b.id)).toEqual(b);
  });
  it('현장 기록 변경 뒤 오래된 초안 적용을 거부하고 두 수정을 보존한다', async () => {
    const p = proposal(trip);
    await repo.propose(p);
    const recorded = await repo.record(trip.id, trip.revision, actualInput());
    await expect(repo.decide(trip.id, p.id, 'apply')).rejects.toThrow('충돌');
    expect(await repo.get(trip.id)).toEqual(recorded);
    expect(recorded.proposals[0].status).toBe('pending');
  });
  it('서로 다른 탭의 동시 쓰기는 하나만 성공한다', async () => {
    const other = new TravelRepository(new TravelDB(repo.db.name));
    const results = await Promise.allSettled([
      repo.record(trip.id, trip.revision, actualInput()),
      other.changePlan(
        trip.id,
        trip.revision,
        [{ type: 'upsert', activity: activity({ title: '현장 수정' }) }],
        '다른 탭',
      ),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect((await repo.get(trip.id)).revision).toBe(trip.revision + 1);
    other.db.close();
  });
  it('계획 변경과 실제 기록 요청 재시도는 중복 저장하지 않는다', async () => {
    const request = uid();
    const a = await repo.record(trip.id, trip.revision, actualInput(), request);
    const b = await repo.record(trip.id, trip.revision, actualInput(), request);
    expect(a).toEqual(b);
    expect(b.actuals).toHaveLength(1);
    await expect(
      repo.record(trip.id, trip.revision, { ...actualInput(), title: '다른 내용' }, request),
    ).rejects.toThrow('재사용');
  });
  it('변경안 적용 재시도는 버전을 한 번만 생성한다', async () => {
    const p = proposal(trip);
    await repo.propose(p);
    const request = uid();
    const a = await repo.decide(trip.id, p.id, 'apply', request);
    const b = await repo.decide(trip.id, p.id, 'apply', request);
    expect(b).toEqual(a);
    expect(b.versions).toHaveLength(3);
    await expect(repo.decide(trip.id, p.id, 'apply')).rejects.toThrow('대기');
  });
  it('실제 기록 정정은 원본을 보존하고 최신 기록을 반환한다', async () => {
    trip = await repo.record(trip.id, trip.revision, actualInput());
    const original = trip.actuals[0];
    trip = await repo.record(trip.id, trip.revision, {
      ...actualInput(),
      supersedes: original.id,
      outcome: 'visited',
      note: '시간을 정정',
    });
    expect(trip.actuals).toHaveLength(2);
    expect(trip.actuals[0]).toEqual(original);
    expect(effectiveActuals(trip)).toHaveLength(1);
    expect(effectiveActuals(trip)[0].outcome).toBe('visited');
    await expect(repo.record(trip.id, trip.revision, { ...actualInput(), supersedes: original.id })).rejects.toThrow(
      '정정',
    );
  });
  it('계획에서 일정을 지워도 실제 기록의 연결과 과거 버전을 유지한다', async () => {
    trip = await repo.record(trip.id, trip.revision, actualInput());
    trip = await repo.changePlan(trip.id, trip.revision, [{ type: 'remove', activityId: 'walk' }], '남은 일정 제거');
    expect(currentPlan(trip).activities).toHaveLength(0);
    expect(trip.actuals[0].activityId).toBe('walk');
    expect(validateTrip(trip)).toEqual(trip);
  });
  it('예정 외 재방문을 독립된 실제 활동으로 저장하고 시각순 정렬한다', async () => {
    trip = await repo.record(trip.id, trip.revision, {
      ...actualInput(),
      activityId: undefined,
      title: '예정 외 책방',
      start: fromLocal('2026-11-07T15:00', trip.timeZone),
      end: fromLocal('2026-11-07T16:00', trip.timeZone),
    });
    trip = await repo.record(trip.id, trip.revision, actualInput());
    expect(effectiveActuals(trip).map((a) => a.title)).toEqual(['강변 산책', '예정 외 책방']);
  });
  it('검증 실패 시 계획·실제·결정·요청 영수증을 부분 저장하지 않는다', async () => {
    const original = await repo.get(trip.id);
    await expect(
      repo.changePlan(
        trip.id,
        trip.revision,
        [{ type: 'upsert', activity: activity({ end: fromLocal('2026-11-07T10:00', trip.timeZone) }) }],
        '잘못된 수정',
      ),
    ).rejects.toThrow('종료');
    expect(await repo.get(trip.id)).toEqual(original);
    await expect(
      repo.changePlan(trip.id, trip.revision, [{ type: 'remove', activityId: 'unknown' }], '잘못된 삭제'),
    ).rejects.toThrow('없습니다');
    expect(await repo.get(trip.id)).toEqual(original);
  });
  it('거절은 계획과 실제 기록을 바꾸지 않는다', async () => {
    const p = proposal(trip);
    await repo.propose(p);
    const rejected = await repo.decide(trip.id, p.id, 'reject');
    expect(rejected.revision).toBe(trip.revision);
    expect(rejected.versions).toEqual(trip.versions);
    expect(rejected.proposals[0].status).toBe('rejected');
  });
});

describe('파일과 시간 검증', () => {
  const legacy = () => ({
    format: 'spfr-daily-cards',
    name: '가상 일일카드',
    timeZone: 'Europe/Paris',
    days: [
      {
        schemaVersion: '1.0',
        day: 1,
        date: '2026-11-07',
        city: 'Paris',
        title: '첫날',
        sourceRefs: ['원본의 자유 텍스트 근거'],
        stops: [
          { id: 'night', name: '야간 산책', start: '23:30', end: '00:30', place_ref: 'river', summary: '가상 일정' },
        ],
      },
      {
        schemaVersion: '1.0',
        day: 2,
        date: '2026-11-08',
        city: 'Paris',
        title: '둘째 날',
        stops: [{ id: 'night', name: '다시 산책', start: '10:00', end: '11:00', place_ref: 'river' }],
      },
    ],
  });
  it('일일카드 두 개에서 날짜별 독립 일정과 자정 경계를 변환한다', () => {
    const t = convertLegacy(legacy());
    expect(t.places).toHaveLength(1);
    expect(t.actuals).toHaveLength(0);
    expect(currentPlan(t).activities.map((a) => a.id)).toEqual(['day-1/night', 'day-2/night']);
    expect(localDate(currentPlan(t).activities[0].end, t.timeZone)).toBe('2026-11-08');
    expect(currentPlan(t).evidence[0].status).toBe('unverified');
  });
  it('잘못된 날짜·시간대·종료 순서·오프셋·외부 필드를 거부한다', () => {
    expect(() =>
      newTrip({ name: '잘못된 날짜', startDate: '2026-02-30', endDate: '2026-03-02', timeZone: 'Europe/Paris' }),
    ).toThrow();
    expect(() => validateTrip({ ...trip, timeZone: 'Unknown/Zone' })).toThrow();
    const invalid = structuredClone(trip);
    invalid.versions[1].activities[0].start = '2026-11-07T11:00:00+09:00';
    expect(() => validateTrip(invalid)).toThrow('오프셋');
    expect(() => validateTrip({ ...trip, token: 'not-a-real-secret' })).toThrow();
  });
  it('DST 모호·없는 현지 시각을 거부하고 기기 시간대와 독립적으로 변환한다', () => {
    expect(() => fromLocal('2026-03-29T02:30', 'Europe/Paris')).toThrow('DST');
    expect(() => fromLocal('2026-10-25T02:30', 'Europe/Paris')).toThrow('DST');
    expect(localInput('2026-11-07T00:00:00Z', 'Asia/Seoul')).toBe('2026-11-07T09:00');
    expect(localDate('2026-11-07T00:00:00Z', 'Pacific/Honolulu')).toBe('2026-11-06');
  });
  it('검증된 전체 백업을 빈 DB에만 원자 복원하고 중복 ID는 거부한다', async () => {
    trip = await repo.record(trip.id, trip.revision, actualInput());
    const backup = await repo.backup();
    const restoredRepo = new TravelRepository(new TravelDB(`restore-${uid()}`));
    try {
      expect(await restoredRepo.restore(backup)).toEqual([trip]);
      expect(await restoredRepo.get(trip.id)).toEqual(trip);
      await expect(restoredRepo.restore(backup)).rejects.toThrow('빈 저장소');
      await expect(repo.restore({ ...backup, trips: [trip, trip] })).rejects.toThrow('중복');
      await expect(repo.importTrip(trip)).rejects.toThrow('덮어쓰지');
    } finally {
      await restoredRepo.db.delete();
    }
  });
  it('파일 미리보기 검증은 저장하지 않고 잘못된 JSON·참조·중복 일차를 거부한다', async () => {
    const parsed = parseFile(JSON.stringify(legacy()));
    expect(parsed.kind).toBe('trip');
    expect(await repo.list()).toHaveLength(1);
    const bad = legacy();
    bad.days.push(bad.days[0]);
    expect(() => convertLegacy(bad)).toThrow('중복');
    const unknown = structuredClone(trip);
    unknown.actuals.push({ ...actualInput(), activityId: 'missing', id: 'a', createdAt: now() });
    unknown.revision++;
    expect(() => parseFile(JSON.stringify({ format: 'travel-app-trip', schemaVersion: 1, trip: unknown }))).toThrow(
      '원본 일정',
    );
    expect(() => parseFile('{ broken')).toThrow();
    expect(() => parseFile(JSON.stringify({ format: 'unknown' }))).toThrow('지원하지');
  });
  it('빈 변경안과 중복 변경 대상은 거부한다', async () => {
    await expect(repo.propose({ ...proposal(trip), operations: [] })).rejects.toThrow();
    const p = proposal(trip);
    p.operations.push(p.operations[0]);
    await expect(repo.propose(p)).rejects.toThrow('중복');
    expect((await repo.get(trip.id)).proposals).toHaveLength(0);
  });
});
