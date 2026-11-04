import { describe, expect, it } from 'vitest';
import { pilotTrip } from './fixtures/pilot';
import { buildRetrospective, itemBadges, planVersionLabel, savedAtLabel } from '../src/content/retro-rules';
import { dayRecordView, groupActualsByDate, placeOnTimeline } from '../src/content/field-rules';
import type { FieldRecord, PlanVersion, TimeSpec, TripDataset } from '../src/contracts/v2/index';

/** C-12 U3: 읽기 화면용 순수 규칙(날짜 묶음·버전 이름·변경 배지·날짜 변화 판정). 저장소를 쓰지 않는다. */

let sequence = 0;
function actual(
  title: string,
  start: TimeSpec,
  options: { supersedes?: string; recordId?: string; commitSeq?: number } = {},
): FieldRecord {
  sequence += 1;
  return {
    tripId: 'trip',
    recordId: options.recordId ?? `record-${sequence}`,
    commitSeq: options.commitSeq ?? sequence,
    kind: 'actual',
    sourceRefs: [],
    recordedAt: '2032-05-01T00:00:00Z',
    ...(options.supersedes ? { supersedes: options.supersedes } : {}),
    payload: {
      title,
      targetSummary: title,
      outcome: 'visited',
      time: { start },
      note: '',
      contextRefs: [],
    },
  } as unknown as FieldRecord;
}
const local = (date: string, localTime: string): TimeSpec => ({
  precision: 'local',
  date,
  localTime,
  timeZoneStatus: 'unknown',
});

describe('실제 기록 날짜 묶음', () => {
  it('날짜 머리 아래 시각 순으로 모으고, 시각을 모르는 기록은 뒤에, 날짜 미상은 따로 둔다', () => {
    const records = [
      actual('저녁', local('2032-05-02', '19:00')),
      actual('시각 모름', { precision: 'date', date: '2032-05-02' }),
      actual('아침', local('2032-05-02', '08:30')),
      actual('다음 날', local('2032-05-03', '07:00')),
      actual('날짜 모름', { precision: 'unspecified' }),
    ];
    const grouping = groupActualsByDate(records);
    expect(grouping.days.map((d) => d.date)).toEqual(['2032-05-02', '2032-05-03']);
    expect(grouping.days[0].entries.map((e) => e.latest.payload.title)).toEqual(['아침', '저녁', '시각 모름']);
    expect(grouping.unknown.map((e) => e.latest.payload.title)).toEqual(['날짜 모름']);
  });

  it('정정 체인은 최신 정정본 한 행이 되고 원문 전체를 chain에 보존하며 날짜는 최신본 기준이다', () => {
    const original = actual('원본', local('2032-05-02', '10:00'), { recordId: 'a' });
    const second = actual('정정 1', local('2032-05-02', '11:00'), { recordId: 'b', supersedes: 'a' });
    const third = actual('정정 2', local('2032-05-03', '09:00'), { recordId: 'c', supersedes: 'b' });
    const grouping = groupActualsByDate([original, second, third]);
    expect(grouping.days.map((d) => d.date)).toEqual(['2032-05-03']);
    const [entry] = grouping.days[0].entries;
    expect(entry.latest.payload.title).toBe('정정 2');
    expect(entry.chain.map((r) => r.payload.title)).toEqual(['원본', '정정 1', '정정 2']);
  });
});

describe('버전 이름', () => {
  it('저장 시각과 이유로 이름을 만들고 현재 계획은 저장 시각만 붙인다', () => {
    expect(savedAtLabel('2032-11-02T05:30:00Z', 'Asia/Seoul')).toBe('11/02 14:30');
    const plan = { createdAt: '2032-11-02T05:30:00Z', reason: '근교 당일치기 이동(가상)', number: 13 };
    expect(planVersionLabel(plan, { current: false, timeZone: 'Asia/Seoul' })).toBe(
      '11/02 14:30 · 근교 당일치기 이동(가상)',
    );
    expect(planVersionLabel(plan, { current: true, timeZone: 'Asia/Seoul' })).toBe('현재 계획 (11/02 14:30)');
  });
});

async function twoPlans(): Promise<{ trip: TripDataset; before: PlanVersion; next: PlanVersion }> {
  const trip = await pilotTrip();
  const before = trip.plans[0];
  const next = structuredClone(before);
  next.planVersionId = 'c12-next-plan';
  next.parentId = before.planVersionId;
  next.number = before.number + 1;
  next.reason = '변경';
  for (const r of [...next.days, ...next.items, ...next.legs, ...next.stays]) {
    r.planVersionId = next.planVersionId;
  }
  trip.plans.push(next);
  trip.header.currentPlanVersionId = next.planVersionId;
  return { trip, before, next };
}
const changeOf = (trip: TripDataset, date: string, beforeId: string, nextId: string) =>
  buildRetrospective(trip, date, beforeId).reasons.find((r) => r.planVersionId === nextId);

describe('CL-14 날짜 변화 판정', () => {
  it('활동은 같아도 날짜 제목만 바뀌면 changed로 판정하고 바뀐 부분을 알린다', async () => {
    const { trip, before, next } = await twoPlans();
    next.days[0].title = '수정한 날짜 제목';
    const reason = changeOf(trip, next.days[0].date, before.planVersionId, next.planVersionId);
    expect(reason?.dayChange).toBe('changed');
    expect(reason?.changedDayParts).toEqual(['day']);
    expect(reason?.changedActivityIds).toEqual([]);
  });

  it('아무것도 바뀌지 않았으면 unchanged다', async () => {
    const { trip, before, next } = await twoPlans();
    const reason = changeOf(trip, next.days[0].date, before.planVersionId, next.planVersionId);
    expect(reason?.dayChange).toBe('unchanged');
    expect(reason?.changedDayParts).toEqual([]);
  });

  it('이동 수단만 바뀌어도 changed다', async () => {
    const { trip, before, next } = await twoPlans();
    const day = next.days.find((d) => next.legs.some((l) => l.dayId === d.dayId));
    expect(day).toBeDefined();
    const leg = next.legs.find((l) => l.dayId === day!.dayId)!;
    leg.mode = `${leg.mode}-수정` as typeof leg.mode;
    const reason = changeOf(trip, day!.date, before.planVersionId, next.planVersionId);
    expect(reason?.dayChange).toBe('changed');
    expect(reason?.changedDayParts).toContain('legs');
  });
});

describe('변경 표시(배지)', () => {
  it('현재 계획에만 있으면 추가, 선택한 계획에만 있으면 제거, 같은 항목은 표시가 없다', async () => {
    const { trip, before, next } = await twoPlans();
    const date = next.days[0].date;
    const dayItems = next.items.filter((i) => i.dayId === next.days[0].dayId);
    expect(dayItems.length).toBeGreaterThan(1);
    const [removedFromNext, ...rest] = dayItems;
    next.items = next.items.filter((i) => i.activityId !== removedFromNext.activityId);
    const added = structuredClone(rest[0]);
    added.activityId = 'c12-added';
    added.title = '새 활동';
    next.items.push(added);
    const view = buildRetrospective(trip, date, before.planVersionId);
    const [currentColumn, selectedColumn] = view.columns;
    expect(currentColumn.badges['c12-added']).toEqual([{ kind: 'added' }]);
    expect(selectedColumn.badges[removedFromNext.activityId]).toEqual([{ kind: 'removed' }]);
    expect(selectedColumn.badges[rest[0].activityId]).toBeUndefined();
    expect(currentColumn.badges[rest[0].activityId]).toBeUndefined();
  });

  it('다른 날짜로 옮긴 항목은 이동, 시각만 다르면 시각 변경이다', async () => {
    const { before, next } = await twoPlans();
    expect(next.days.length).toBeGreaterThan(1);
    const date = next.days[0].date;
    const otherDate = next.days[1].date;
    const dayItems = next.items.filter((i) => i.dayId === next.days[0].dayId);
    expect(dayItems.length).toBeGreaterThan(1);
    const mover = dayItems[0];
    mover.dayId = next.days[1].dayId;
    const retimed = dayItems[1];
    retimed.time = { ...retimed.time, start: local(date, '23:10') };
    const selectedSide = itemBadges(before, next, date, 'selected');
    expect(selectedSide[mover.activityId]).toEqual([{ kind: 'moved', otherDate }]);
    expect(selectedSide[retimed.activityId]).toEqual(expect.arrayContaining([{ kind: 'time-changed' }]));
    const currentSide = itemBadges(next, before, otherDate, 'current');
    expect(currentSide[mover.activityId]).toEqual([{ kind: 'moved', otherDate: date }]);
  });

  it('한 열만 보일 때는 표시가 없다', async () => {
    const { trip, next } = await twoPlans();
    const view = buildRetrospective(trip, next.days[0].date);
    expect(view.columns).toHaveLength(1);
    expect(view.columns[0].badges).toEqual({});
  });
});

describe('C8 오늘 타임라인의 실제 기록', () => {
  const withActivity = (record: FieldRecord, activityId: string) => {
    (record as unknown as { payload: Record<string, unknown> }).payload.activityId = activityId;
    return record;
  };
  const item = (activityId: string, clock?: string) => ({
    activityId,
    time: { start: clock ? local('2032-05-02', clock) : ({ precision: 'unspecified' } as TimeSpec) },
  });

  it('항목에 연결된 기록은 최신 정정본만 배지로, 연결되지 않은 이 날짜 기록은 전용 카드로 모은다', () => {
    const visit = withActivity(actual('방문', local('2032-05-02', '14:20'), { recordId: 'v1' }), 'a1');
    const fix = withActivity(
      actual('방문 정정', local('2032-05-02', '14:35'), { recordId: 'v2', supersedes: 'v1' }),
      'a1',
    );
    const free = actual('길가의 벤치', local('2032-05-02', '12:00'));
    const otherDay = actual('다른 날', local('2032-05-03', '09:00'));
    const removed = withActivity(actual('지운 항목의 기록', local('2032-05-02', '16:00')), 'gone');
    const view = dayRecordView([visit, fix, free, otherDay, removed], new Set(['a1']), '2032-05-02');
    expect(view.byActivity.get('a1')?.payload.title).toBe('방문 정정');
    expect(view.standalone.map((e) => e.latest.payload.title)).toEqual(['길가의 벤치', '지운 항목의 기록']);
  });

  it('기록 카드는 시각 순서에 맞춰 항목 사이에 끼고, 시각이 없거나 가장 늦으면 맨 아래에 둔다', () => {
    const items = [item('a', '09:00'), item('b', '13:00'), item('c', '18:00')];
    const morning = actual('이른 기록', local('2032-05-02', '08:00'));
    const noon = actual('점심 기록', local('2032-05-02', '12:00'));
    const night = actual('밤 기록', local('2032-05-02', '23:00'));
    const untimed = actual('시각 없음', { precision: 'date', date: '2032-05-02' });
    const placement = placeOnTimeline(
      items,
      [morning, noon, night, untimed].map((latest) => ({ latest, chain: [latest] }) as never),
    );
    expect(placement.before.get('a')?.map((e) => e.latest.payload.title)).toEqual(['이른 기록']);
    expect(placement.before.get('b')?.map((e) => e.latest.payload.title)).toEqual(['점심 기록']);
    expect(placement.trailing.map((e) => e.latest.payload.title)).toEqual(['밤 기록', '시각 없음']);
  });
});
