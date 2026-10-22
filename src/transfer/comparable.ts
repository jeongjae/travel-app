import type { PlanVersion, TripDataset } from '../contracts/v2/index.ts';
export function comparablePlan(p: PlanVersion) {
  const strip = <T extends { planVersionId: string }>(row: T) => {
    const { planVersionId: _, ...rest } = row;
    return rest;
  };
  return { days: p.days.map(strip), items: p.items.map(strip), legs: p.legs.map(strip), stays: p.stays.map(strip) };
}
export function comparableTrip(h: TripDataset['header']) {
  const { tripId: _, domainRevision: _d, currentPlanVersionId: _p, ...rest } = h;
  return rest;
}
