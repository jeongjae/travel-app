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
    expect(picked.ok && picked.placements).toEqual([{ key: expect.any(String), beforeTitle: first[1].title }]);
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
