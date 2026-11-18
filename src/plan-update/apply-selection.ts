import { planItemSchema, planStaySchema } from '../contracts/v2';
import { placeInOrder } from './place-in-order';
import type { ChangeEntry, CurrentTrip, SelectionResult, UpdateOperation, UpdateResult } from './update-types';

type ReadyResult = Extract<UpdateResult, { status: 'ready' }>;

function targetOf(operation: UpdateOperation) {
  switch (operation.type) {
    case 'upsert-item':
      return `활동:${operation.item.activityId}`;
    case 'remove-item':
      return `활동:${operation.activityId}`;
    case 'upsert-stay':
      return `숙소:${operation.stay.stayId}`;
    case 'remove-stay':
      return `숙소:${operation.stayId}`;
  }
}

/** 고른 변경만 현재 계획에 적용해 본 결과가 유효한지 다시 검사한다(AC-11). 문제 목록이 비면 유효하다. */
function problemsOf(entries: ChangeEntry[], current: CurrentTrip) {
  const { plan } = current;
  const problems: string[] = [];
  const items = new Map(plan.items.map((item) => [item.activityId, item]));
  const stays = new Map(plan.stays.map((stay) => [stay.stayId, stay]));
  const dayIds = new Set(plan.days.map((day) => day.dayId));
  const seen = new Set<string>();
  for (const { operation, title } of entries) {
    const target = targetOf(operation);
    if (seen.has(target)) {
      problems.push(`"${title}"이 한 번 넘게 들어 있습니다.`);
    }
    seen.add(target);
    if (operation.type === 'upsert-item') {
      const valid = planItemSchema.safeParse(operation.item).success && dayIds.has(operation.item.dayId);
      if (!valid || operation.item.planVersionId !== plan.planVersionId) {
        problems.push(`"${title}"이 현재 계획과 맞지 않습니다.`);
      }
      items.set(operation.item.activityId, operation.item);
    } else if (operation.type === 'remove-item') {
      if (!items.delete(operation.activityId)) {
        problems.push(`삭제할 활동 "${title}"이 현재 계획에 없습니다.`);
      }
    } else if (operation.type === 'upsert-stay') {
      const { start, end } = operation.stay.time;
      const valid = planStaySchema.safeParse(operation.stay).success && (end?.date ?? '') > (start.date ?? '');
      if (!valid || operation.stay.planVersionId !== plan.planVersionId) {
        problems.push(`숙소 "${title}"이 현재 계획과 맞지 않습니다.`);
      }
      stays.set(operation.stay.stayId, operation.stay);
    } else if (!stays.delete(operation.stayId)) {
      problems.push(`삭제할 숙소 "${title}"이 현재 계획에 없습니다.`);
    }
  }
  for (const leg of plan.legs) {
    const from = items.get(leg.fromActivityId);
    const to = items.get(leg.toActivityId);
    if (!from || !to || from.dayId !== leg.dayId || to.dayId !== leg.dayId) {
      problems.push('고른 변경 때문에 이동의 출발·도착 활동이 사라지거나 다른 날짜가 됩니다.');
    }
  }
  return problems;
}

/**
 * 사용자가 고른 변경(`selectedKeys`)만 모아 `ChangePlan` 연산으로 만든다. 모으기 전에 고른 결과 전체를 다시 검사한다.
 * 건너뜀 후보도 고르면 들어간다.
 */
export function buildSelection(
  result: ReadyResult,
  selectedKeys: ReadonlySet<string>,
  current: CurrentTrip,
): SelectionResult {
  const entries = [...result.changes, ...result.skipped].filter((entry) => selectedKeys.has(entry.key));
  if (entries.length === 0) {
    return { ok: false, problems: ['적용할 변경을 하나 이상 고르세요.'] };
  }
  const problems = problemsOf(entries, current);
  if (problems.length > 0) {
    return { ok: false, problems };
  }
  const count = (kinds: ChangeEntry['kind'][]) => entries.filter((entry) => kinds.includes(entry.kind)).length;
  const counts = { edit: count(['edit', 'move']), add: count(['add']), remove: count(['delete']) };
  const ordered = placeInOrder(entries, current);
  return {
    ok: true,
    operations: ordered.operations,
    shifted: ordered.shifted,
    placements: ordered.placements,
    counts,
    reason: `AI 결과 붙여넣기: 수정 ${counts.edit}·추가 ${counts.add}·삭제 ${counts.remove}`,
  };
}
