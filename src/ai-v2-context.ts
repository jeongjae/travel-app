import { aiV2RequestSchema } from './ai-v2-contract.ts';
import type { TripDataset } from './contracts/v2/index.ts';

export function buildAiV2Request(
  dataset: TripDataset,
  prompt: string,
  fromDate: string,
  count: number,
  includeRecords: boolean,
) {
  const current = dataset.plans.find((plan) => plan.planVersionId === dataset.header.currentPlanVersionId)!;
  const days = current.days
    .filter((day) => day.date >= fromDate)
    .sort((a, b) => a.ordinal - b.ordinal)
    .slice(0, Math.min(7, Math.max(1, count)));
  const selected = new Set(days.map((day) => day.dayId));
  const items = current.items
    .filter((item) => selected.has(item.dayId))
    .map((item) => {
      const { reservationText: _, executionNote: __, ...rest } = item;
      return rest;
    });
  const itemIds = new Set(items.map((item) => item.activityId));
  const places = dataset.contents.filter(
    (content) =>
      content.kind === 'place' &&
      dataset.heads.some(
        (head) =>
          head.targetKind === content.kind &&
          head.entityId === content.entityId &&
          head.revisionId === content.revisionId &&
          head.status === 'active',
      ),
  );
  return aiV2RequestSchema.parse({
    id: crypto.randomUUID(),
    prompt,
    fromDate,
    consent: true,
    context: {
      header: dataset.header,
      plan: {
        ...current,
        contextRefs: [],
        stays: [],
        days,
        items,
        legs: current.legs.filter(
          (leg) => selected.has(leg.dayId) && itemIds.has(leg.fromActivityId) && itemIds.has(leg.toActivityId),
        ),
      },
      places: places.map((content) => ({
        id: content.entityId,
        name: content.kind === 'place' ? content.payload.name : '',
        summary: content.kind === 'place' ? content.payload.summary : '',
      })),
      records: includeRecords
        ? dataset.records.map((record) => ({
            id: record.recordId,
            kind: record.kind,
            recordedAt: record.recordedAt,
            summary:
              record.kind === 'actual'
                ? `${record.payload.title} · ${record.payload.outcome} · ${record.payload.note}`
                : record.kind === 'note'
                  ? record.payload.body
                  : record.kind === 'legacy-state'
                    ? `${record.payload.state} · ${record.payload.note} · 실제 방문 시각 미상`
                    : `작업 체크 · ${record.payload.completed}`,
          }))
        : [],
    },
  });
}
