import type { PlanVersion, TripDataset } from '../contracts/v2/index.ts';

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * 계획 비교 표현. 배열 위치는 의미가 없으므로(저장소는 기본 키 순서로, 패키지는 원천 순서로 돌려준다)
 * 날짜 행의 ordinal·안정 ID와 항목의 dayId·order·안정 ID로 정렬해 같은 의미가 같은 표현이 되게 한다.
 * 필드 값은 건드리지 않으므로 순서(order) 값·날짜 이동·제목/시간 변경은 그대로 차이로 남는다.
 */
export function comparablePlan(p: PlanVersion) {
  const strip = <T extends { planVersionId: string }>(row: T) => {
    const { planVersionId: _, ...rest } = row;
    return rest;
  };
  const days = [...p.days].sort((a, b) => a.ordinal - b.ordinal || byText(a.dayId, b.dayId));
  const dayRank = new Map(days.map((day, index) => [day.dayId, index]));
  const rank = (dayId: string) => dayRank.get(dayId) ?? Number.MAX_SAFE_INTEGER;
  const items = [...p.items].sort(
    (a, b) => rank(a.dayId) - rank(b.dayId) || a.order - b.order || byText(a.activityId, b.activityId),
  );
  const legs = [...p.legs].sort(
    (a, b) => rank(a.dayId) - rank(b.dayId) || byText(a.dayId, b.dayId) || byText(a.legId, b.legId),
  );
  const stays = [...p.stays].sort((a, b) => byText(a.stayId, b.stayId));
  return { days: days.map(strip), items: items.map(strip), legs: legs.map(strip), stays: stays.map(strip) };
}
export function comparableTrip(h: TripDataset['header']) {
  const { tripId: _, domainRevision: _d, currentPlanVersionId: _p, ...rest } = h;
  return rest;
}
