import type { PlanVersion, TripDataset } from '../contracts/v2/index.ts';

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * 계획 비교 표현. 배열 위치는 의미가 없으므로(저장소는 기본 키 순서로, 패키지는 원천 순서로 돌려준다)
 * 날짜 행의 ordinal·안정 ID와 항목의 dayId·order·안정 ID로 정렬해 같은 의미가 같은 표현이 되게 한다.
 * 필드 값은 건드리지 않으므로 순서(order) 값·날짜 이동·제목/시간 변경은 그대로 차이로 남는다.
 */
type Stripped<T> = Omit<T, 'planVersionId'>;
type ComparablePlanValue = {
  days: Stripped<PlanVersion['days'][number]>[];
  items: Stripped<PlanVersion['items'][number]>[];
  legs: Stripped<PlanVersion['legs'][number]>[];
  stays: Stripped<PlanVersion['stays'][number]>[];
};

/**
 * 이미 만들어진 비교 표현(planVersionId 제외 형태)의 네 배열만 정렬해 같은 의미가 같은 표현이 되게 한다.
 * T-05 이전 패키지의 기준 B와 DB에 저장된 기준은 배열 순서를 보존한 채 만들어졌으므로,
 * 비교하는 모든 쪽(현재·기준·새 원천)에 같은 정규화를 적용한다.
 * 입력은 바꾸지 않고 저장된 기준도 다시 쓰지 않는다. 네 배열 외의 필드와 행의 추가 필드는 그대로 보존해
 * 기준 B가 대상과 다르면 계속 불일치로 드러나게 한다.
 */
export function canonicalPlanValue<T>(value: T): T {
  const plan = value as unknown as Partial<ComparablePlanValue> | null;
  if (!plan || typeof plan !== 'object' || ![plan.days, plan.items, plan.legs, plan.stays].every(Array.isArray)) {
    return value;
  }
  const days = [...plan.days!].sort((a, b) => a.ordinal - b.ordinal || byText(a.dayId, b.dayId));
  const dayRank = new Map(days.map((day, index) => [day.dayId, index]));
  const rank = (row: { dayId: string }) => dayRank.get(row.dayId) ?? Number.MAX_SAFE_INTEGER;
  const items = [...plan.items!].sort(
    (a, b) => rank(a) - rank(b) || a.order - b.order || byText(a.activityId, b.activityId),
  );
  const legs = [...plan.legs!].sort(
    (a, b) => rank(a) - rank(b) || byText(a.dayId, b.dayId) || byText(a.legId, b.legId),
  );
  const stays = [...plan.stays!].sort((a, b) => byText(a.stayId, b.stayId));
  return { ...plan, days, items, legs, stays } as unknown as T;
}

/** 계획 비교 표현. 배열 위치는 의미가 없으므로 안정 키(날짜 ordinal·dayId, 항목 order·ID 등)로 정렬한다. */
export function comparablePlan(p: PlanVersion) {
  const strip = <T extends { planVersionId: string }>(row: T) => {
    const { planVersionId: _, ...rest } = row;
    return rest;
  };
  return canonicalPlanValue({
    days: p.days.map(strip),
    items: p.items.map(strip),
    legs: p.legs.map(strip),
    stays: p.stays.map(strip),
  });
}
export function comparableTrip(h: TripDataset['header']) {
  const { tripId: _, domainRevision: _d, currentPlanVersionId: _p, ...rest } = h;
  return rest;
}
