import type { PlanVersion } from '../contracts/v2';
import type { ChangeEntry, CurrentTrip, UpdateOperation } from './update-types';
type PlanItem = PlanVersion['items'][number];

export type Placement = {
  /** 끼우는 변경의 열쇠. */
  key: string;
  /** 이 활동 앞에 들어간다. 없으면 그날 마지막. */
  beforeTitle?: string;
};

export type OrderedOperations = {
  operations: UpdateOperation[];
  /** 내용은 그대로이고 번호만 밀리는 기존 활동 수. */
  shifted: number;
  placements: Placement[];
};

/** 날짜를 포함한 시작 시각. 시각이 없으면(미정·날짜만·글·절대 시각) `undefined`. */
function startKeyOf(item: PlanItem) {
  const { start } = item.time;
  return start && start.precision === 'local' ? `${start.date} ${start.localTime}` : undefined;
}

type Slot = { inserters: ChangeEntry[] };

/**
 * 고른 변경 중 새 활동(`add`)과 날짜를 옮긴 활동(`move`)을 그 날짜의 시간순 자리에 넣는다.
 * 기존 활동끼리의 순서는 바꾸지 않고, 번호가 겹치면 뒤의 기존 활동 번호만 민다.
 * 입력 연산은 바꾸지 않는다.
 */
export function placeInOrder(entries: ChangeEntry[], current: CurrentTrip): OrderedOperations {
  const operations = entries.map((entry) => structuredClone(entry.operation));
  const items = new Map(current.plan.items.map((item) => [item.activityId, structuredClone(item)]));
  const inserterByKey = new Map<string, { entry: ChangeEntry; item: PlanItem }>();
  const operationIndex = new Map<string, number>();
  entries.forEach((entry, index) => {
    const operation = operations[index];
    if (operation.type === 'upsert-item') {
      operationIndex.set(operation.item.activityId, index);
      if (entry.kind === 'add' || entry.kind === 'move') {
        inserterByKey.set(entry.key, { entry, item: operation.item });
      }
    } else if (operation.type === 'remove-item') {
      items.delete(operation.activityId);
    }
  });
  entries.forEach((_entry, index) => {
    const operation = operations[index];
    if (operation.type === 'upsert-item') {
      items.set(operation.item.activityId, operation.item);
    }
  });

  const inserterIds = new Set([...inserterByKey.values()].map(({ item }) => item.activityId));
  const lineOf = new Map(entries.map((entry, index) => [entry.key, index]));
  const dayIds = new Set([...inserterByKey.values()].map(({ item }) => item.dayId));
  const extra: UpdateOperation[] = [];
  const placements: Placement[] = [];

  for (const dayId of dayIds) {
    const existing = [...items.values()]
      .filter((item) => item.dayId === dayId && !inserterIds.has(item.activityId))
      .sort((a, b) => a.order - b.order);
    const slots: Slot[] = Array.from({ length: existing.length + 1 }, () => ({ inserters: [] }));
    const mine = [...inserterByKey.values()]
      .filter(({ item }) => item.dayId === dayId)
      .sort((a, b) => {
        const left = startKeyOf(a.item);
        const right = startKeyOf(b.item);
        if (left !== right) {
          if (left === undefined) {
            return 1;
          }
          if (right === undefined) {
            return -1;
          }
          return left < right ? -1 : 1;
        }
        return (lineOf.get(a.entry.key) ?? 0) - (lineOf.get(b.entry.key) ?? 0);
      });
    for (const { entry, item } of mine) {
      const start = startKeyOf(item);
      const index =
        start === undefined
          ? existing.length
          : existing.findIndex((other) => {
              const otherStart = startKeyOf(other);
              return otherStart !== undefined && otherStart > start;
            });
      const slot = index === -1 ? existing.length : index;
      slots[slot].inserters.push(entry);
      placements.push({ key: entry.key, beforeTitle: existing[slot]?.title });
    }

    let previous = -1;
    const place = (item: PlanItem, movable: boolean) => {
      const wanted = movable ? Math.max(item.order, previous + 1) : previous + 1;
      previous = wanted;
      return wanted;
    };
    const assign = (entry: ChangeEntry) => {
      const found = inserterByKey.get(entry.key)!;
      found.item.order = place(found.item, false);
    };
    existing.forEach((item, index) => {
      slots[index].inserters.forEach(assign);
      const order = place(item, true);
      if (order === item.order) {
        return;
      }
      item.order = order;
      const at = operationIndex.get(item.activityId);
      if (at === undefined) {
        extra.push({ type: 'upsert-item', item: structuredClone(item) });
      }
    });
    slots[existing.length].inserters.forEach(assign);
  }

  const shiftedCount = extra.length;
  return { operations: [...operations, ...extra], shifted: shiftedCount, placements };
}
