import { describe, expect, it } from 'vitest';
import { buildSelection, computeUpdate, exportPlan, type CurrentTrip } from '../src/plan-update';
import { check, createdTrip, fixture } from './plan-import-helpers';
import { currentOf, partialUpdate, ready } from './plan-update-helpers';

/** R1: 새 활동·날짜를 옮긴 활동은 그날의 시간순 자리에 들어간다. 가상 고정 자료만 쓴다. */
function setup() {
  const created = createdTrip(fixture('claude-t1-run2.md'));
  const current = currentOf(created);
  const [day, other] = [...current.plan.days].sort((a, b) => a.date.localeCompare(b.date));
  const sorted = (dayId: string) =>
    current.plan.items.filter((item) => item.dayId === dayId).sort((a, b) => a.order - b.order);
  return { current, day, other, first: sorted(day.dayId), second: sorted(other.dayId) };
}

function select(current: CurrentTrip, text: string, only?: (title: string) => boolean) {
  const result = ready(computeUpdate(check(text), current));
  const keys = [...result.changes, ...result.skipped]
    .filter((change) => (only ? only(change.title) : true))
    .map((change) => change.key);
  const picked = buildSelection(result, new Set(keys), current);
  if (!picked.ok) {
    throw new Error(picked.problems.join(' '));
  }
  return { result, picked };
}

/** 적용한 뒤 그날의 활동 제목을 order 순서대로. */
function titlesAfter(current: CurrentTrip, operations: ReturnType<typeof select>['picked'], dayId: string) {
  if (!operations.ok) {
    throw new Error('선택 실패');
  }
  const items = new Map(current.plan.items.map((item) => [item.activityId, item]));
  for (const operation of operations.operations) {
    if (operation.type === 'upsert-item') {
      items.set(operation.item.activityId, operation.item);
    } else if (operation.type === 'remove-item') {
      items.delete(operation.activityId);
    }
  }
  const day = [...items.values()].filter((item) => item.dayId === dayId).sort((a, b) => a.order - b.order);
  expect(new Set(day.map((item) => item.order)).size).toBe(day.length);
  return day.map((item) => item.title);
}

const text = (current: CurrentTrip, rows: Record<string, string[]>) =>
  partialUpdate(exportPlan(current).text, {
    days: Object.entries(rows).map(([heading, list]) => ({ heading, rows: list })),
  });

describe('시간순 자리에 넣기 (R1)', () => {
  it('가운데에 끼운다: 자기보다 늦은 첫 기존 활동 바로 앞', () => {
    const { current, day, first } = setup();
    const { picked } = select(current, text(current, { [day.date]: ['|  | 15:00 | 끼운 활동 | 기타 |  |  |  |  |'] }));
    expect(titlesAfter(current, picked, day.dayId)).toEqual([
      first[0].title,
      '끼운 활동',
      ...first.slice(1).map((i) => i.title),
    ]);
    expect(picked.ok && picked.placements).toEqual([
      { key: expect.any(String), beforeTitle: first[1].title, mode: 'insert', legCount: 0 },
    ]);
    expect(picked.ok && picked.shifted).toBe(first.length - 1);
    expect(picked.ok && picked.counts).toEqual({ edit: 0, add: 1, remove: 0 });
    expect(picked.ok && picked.reason).toBe('AI 결과 붙여넣기: 수정 0·추가 1·삭제 0');
  });

  it('늦은 활동이 없으면 맨 끝, 번호는 밀리지 않는다', () => {
    const { current, day, first } = setup();
    const { picked } = select(current, text(current, { [day.date]: ['|  | 23:50 | 밤 활동 | 기타 |  |  |  |  |'] }));
    expect(titlesAfter(current, picked, day.dayId)).toEqual([...first.map((i) => i.title), '밤 활동']);
    expect(picked.ok && picked.shifted).toBe(0);
    expect(picked.ok && picked.placements[0].beforeTitle).toBeUndefined();
  });

  it('시간 미정은 맨 끝에 둔다', () => {
    const { current, day, first } = setup();
    const { picked } = select(current, text(current, { [day.date]: ['|  |  | 시간 없는 활동 | 기타 |  |  |  |  |'] }));
    expect(titlesAfter(current, picked, day.dayId)).toEqual([...first.map((i) => i.title), '시간 없는 활동']);
  });

  it('같은 날 둘 이상은 시작 시각순, 같으면 글의 줄 순서', () => {
    const { current, day, first } = setup();
    const rows = [
      '|  | 15:10 | 나중 | 기타 |  |  |  |  |',
      '|  | 15:00 | 먼저 A | 기타 |  |  |  |  |',
      '|  | 15:00 | 먼저 B | 기타 |  |  |  |  |',
    ];
    const { picked } = select(current, text(current, { [day.date]: rows }));
    expect(titlesAfter(current, picked, day.dayId)).toEqual([
      first[0].title,
      '먼저 A',
      '먼저 B',
      '나중',
      ...first.slice(1).map((i) => i.title),
    ]);
  });

  it('기존 활동끼리의 순서는 시간순이 아니어도 바꾸지 않는다', () => {
    const { current, day, first } = setup();
    const scrambled = structuredClone(current);
    const items = scrambled.plan.items.filter((item) => item.dayId === day.dayId).sort((a, b) => a.order - b.order);
    [items[1].order, items[2].order] = [items[2].order, items[1].order];
    const before = scrambled.plan.items
      .filter((item) => item.dayId === day.dayId)
      .sort((a, b) => a.order - b.order)
      .map((item) => item.title);
    const { picked } = select(
      scrambled,
      text(scrambled, { [day.date]: ['|  | 15:00 | 끼운 활동 | 기타 |  |  |  |  |'] }),
    );
    const after = titlesAfter(scrambled, picked, day.dayId).filter((title) => title !== '끼운 활동');
    expect(after).toEqual(before);
    expect(after).toHaveLength(first.length);
  });

  it('일부만 고르면 고른 것만으로 자리를 정한다', () => {
    const { current, day, first } = setup();
    const rows = ['|  | 15:00 | 고름 | 기타 |  |  |  |  |', '|  | 15:05 | 안 고름 | 기타 |  |  |  |  |'];
    const { picked } = select(current, text(current, { [day.date]: rows }), (title) => title === '고름');
    const titles = titlesAfter(current, picked, day.dayId);
    expect(titles).toContain('고름');
    expect(titles).not.toContain('안 고름');
    expect(titles.indexOf('고름')).toBe(1);
    expect(titles).toHaveLength(first.length + 1);
  });

  it('추가와 삭제를 함께 고르면 삭제한 활동은 비교에서 빠진다', () => {
    const { current, day, first } = setup();
    const base = partialUpdate(exportPlan(current).text, {
      days: [{ heading: day.date, rows: ['|  | 15:00 | 끼운 활동 | 기타 |  |  |  |  |'] }],
      deletions: [['활동', first[1].activityId, first[1].title]],
    });
    const { picked } = select(current, base);
    expect(titlesAfter(current, picked, day.dayId)).toEqual([
      first[0].title,
      '끼운 활동',
      ...first.slice(2).map((i) => i.title),
    ]);
    expect(picked.ok && picked.placements[0].beforeTitle).toBe(first[2].title);
  });

  it('날짜를 옮긴 활동도 시간순 자리에 들어간다', () => {
    const { current, day, second } = setup();
    const moving = second.find((item) => item.time.start?.precision === 'local')!;
    const row = `| ${moving.activityId} | 15:05-16:00 |  |  |  |  |  |  |`;
    const { picked, result } = select(current, text(current, { [day.date]: [row] }));
    expect(result.changes.map((change) => change.kind)).toEqual(['move']);
    const titles = titlesAfter(current, picked, day.dayId);
    expect(titles.indexOf(moving.title)).toBe(1);
    expect(picked.ok && picked.counts).toEqual({ edit: 1, add: 0, remove: 0 });
  });

  it('번호가 밀리는 활동을 같은 글에서 수정해도 그 활동의 연산은 하나다', () => {
    const { current, day, first } = setup();
    const target = first[1];
    const rows = [
      '|  | 15:00 | 끼운 활동 | 기타 |  |  |  |  |',
      `| ${target.activityId} |  | 이름 바뀜 |  |  |  |  |  |`,
    ];
    const { picked } = select(current, text(current, { [day.date]: rows }));
    expect(picked.ok).toBe(true);
    if (!picked.ok) {
      return;
    }
    const mine = picked.operations.filter(
      (operation) => operation.type === 'upsert-item' && operation.item.activityId === target.activityId,
    );
    expect(mine).toHaveLength(1);
    expect(picked.counts).toEqual({ edit: 1, add: 1, remove: 0 });
    const titles = titlesAfter(current, picked, day.dayId);
    expect(titles[1]).toBe('끼운 활동');
    expect(titles[2]).toBe('이름 바뀜');
  });

  it('입력 연산을 바꾸지 않고, 제자리 수정은 순서를 건드리지 않는다', () => {
    const { current, day, first } = setup();
    const rows = [`| ${first[2].activityId} |  | 이름만 |  |  |  |  |  |`];
    const { picked, result } = select(current, text(current, { [day.date]: rows }));
    expect(picked.ok && picked.shifted).toBe(0);
    expect(picked.ok && picked.placements).toEqual([]);
    const before = JSON.stringify(result.changes.map((change) => change.operation));
    buildSelection(result, new Set(result.changes.map((change) => change.key)), current);
    expect(JSON.stringify(result.changes.map((change) => change.operation))).toBe(before);
  });
});

describe('시작 시각이 바뀐 기존 활동의 자리 (R2)', () => {
  const clockOf = (item: { time: { start?: { precision: string; localTime?: string } } }) =>
    item.time.start?.precision === 'local' ? item.time.start.localTime!.slice(0, 5) : '';

  function rowFor(id: string, time: string) {
    return `| ${id} | ${time} |  |  |  |  |  |  |`;
  }

  it('전제: 첫날 활동은 시간순이다', () => {
    const { first } = setup();
    expect(first.map(clockOf).slice(0, 5)).toEqual(['14:00', '15:30', '16:30', '17:30', '19:00']);
  });

  it('시각을 늦추면 뒤로 옮기고, 번호만 바뀐 활동은 수정으로 세지 않는다', () => {
    const { current, day, first } = setup();
    const { picked } = select(current, text(current, { [day.date]: [rowFor(first[0].activityId, '18:00')] }));
    const names = first.map((item) => item.title);
    expect(titlesAfter(current, picked, day.dayId)).toEqual([names[1], names[2], names[3], names[0], names[4]]);
    expect(picked.ok && picked.placements).toEqual([
      { key: expect.any(String), beforeTitle: names[4], mode: 'relocate', legCount: 0 },
    ]);
    expect(picked.ok && picked.counts).toEqual({ edit: 1, add: 0, remove: 0 });
  });

  it('시각을 앞당기면 앞으로 옮긴다', () => {
    const { current, day, first } = setup();
    const { picked } = select(current, text(current, { [day.date]: [rowFor(first[3].activityId, '15:00')] }));
    const names = first.map((item) => item.title);
    expect(titlesAfter(current, picked, day.dayId)).toEqual([names[0], names[3], names[1], names[2], names[4]]);
    expect(picked.ok && picked.placements[0]).toMatchObject({ beforeTitle: names[1], mode: 'relocate' });
  });

  it('그날 마지막보다 늦추면 마지막으로 옮긴다는 안내가 붙는다', () => {
    const { current, day, first } = setup();
    const { picked } = select(current, text(current, { [day.date]: [rowFor(first[1].activityId, '23:00')] }));
    const names = first.map((item) => item.title);
    expect(titlesAfter(current, picked, day.dayId)).toEqual([names[0], names[2], names[3], names[4], names[1]]);
    expect(picked.ok && picked.placements[0].beforeTitle).toBeUndefined();
  });

  it('자리가 같으면 번호도 안내도 바꾸지 않는다', () => {
    const { current, day, first } = setup();
    const { picked } = select(current, text(current, { [day.date]: [rowFor(first[1].activityId, '15:45')] }));
    expect(picked.ok && picked.placements).toEqual([]);
    expect(picked.ok && picked.shifted).toBe(0);
    expect(titlesAfter(current, picked, day.dayId)).toEqual(first.map((item) => item.title));
    if (picked.ok) {
      const op = picked.operations[0];
      expect(op.type === 'upsert-item' && op.item.order).toBe(first[1].order);
    }
  });

  it('종료 시각만 바뀌면 자리를 옮기지 않는다', () => {
    const { current, day, first } = setup();
    const { picked } = select(current, text(current, { [day.date]: [rowFor(first[1].activityId, '15:30-16:10')] }));
    expect(picked.ok && picked.placements).toEqual([]);
    expect(titlesAfter(current, picked, day.dayId)).toEqual(first.map((item) => item.title));
  });

  it('시각을 (비움)으로 지우면 시간 미정이 되어도 자리는 그대로다', () => {
    const { current, day, first } = setup();
    const { picked } = select(current, text(current, { [day.date]: [rowFor(first[1].activityId, '(비움)')] }));
    expect(picked.ok && picked.placements).toEqual([]);
    expect(titlesAfter(current, picked, day.dayId)).toEqual(first.map((item) => item.title));
  });

  function withLeg(current: CurrentTrip, dayId: string, from: string, to: string) {
    const linked = structuredClone(current);
    linked.plan.legs.push({
      tripId: current.header.tripId,
      planVersionId: current.plan.planVersionId,
      legId: 'leg-r3',
      dayId,
      fromActivityId: from,
      toActivityId: to,
      mode: '도보',
    });
    return linked;
  }

  it('이동이 연결된 활동도 시각을 늦추면 뒤로 옮기고 이동 연산은 만들지 않는다 (R3)', () => {
    const { current, day, first } = setup();
    const linked = withLeg(current, day.dayId, first[1].activityId, first[2].activityId);
    const { picked } = select(linked, text(linked, { [day.date]: [rowFor(first[1].activityId, '23:00')] }));
    expect(picked.ok && picked.placements).toEqual([{ key: expect.any(String), mode: 'relocate', legCount: 1 }]);
    const names = first.map((item) => item.title);
    expect(titlesAfter(linked, picked, day.dayId)).toEqual([names[0], names[2], names[3], names[4], names[1]]);
    expect(picked.ok && picked.operations.some((operation) => operation.type.includes('leg'))).toBe(false);
  });

  it('이동이 연결된 활동도 시각을 앞당기면 앞으로 옮기고, 이동 수를 센다 (R3)', () => {
    const { current, day, first } = setup();
    const linked = withLeg(current, day.dayId, first[1].activityId, first[3].activityId);
    const { picked } = select(linked, text(linked, { [day.date]: [rowFor(first[3].activityId, '05:00')] }));
    expect(picked.ok && picked.placements[0]).toMatchObject({ mode: 'relocate', legCount: 1 });
    const names = first.map((item) => item.title);
    expect(titlesAfter(linked, picked, day.dayId)[0]).toBe(names[3]);
  });

  it('같은 날 추가와 시각 변경을 함께 고르면 둘 다 시간순에 놓인다', () => {
    const { current, day, first } = setup();
    const rows = ['|  | 15:00 | 끼운 활동 | 기타 |  |  |  |  |', rowFor(first[3].activityId, '15:10')];
    const { picked } = select(current, text(current, { [day.date]: rows }));
    const names = first.map((item) => item.title);
    expect(titlesAfter(current, picked, day.dayId)).toEqual([
      names[0],
      '끼운 활동',
      names[3],
      names[1],
      names[2],
      names[4],
    ]);
    expect(picked.ok && picked.counts).toEqual({ edit: 1, add: 1, remove: 0 });
  });
});
