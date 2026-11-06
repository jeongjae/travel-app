import type { ContentRevision, PlanVersion, Proposal } from '../contracts/v2';
import {
  classifySource,
  isUnrealisticTime,
  isVolatileFact,
  officialHosts,
  operationReasonsRef,
  timeSpan,
  toMinutes,
  type SourceKind,
} from '../ai-v2-semantics';

/** 변경안 검토의 읽기 모델. 저장된 변경안과 현재 계획에서 계산하며 아무것도 쓰지 않는다. */
type Evidence = Extract<ContentRevision, { kind: 'evidence' }>;
type Item = PlanVersion['items'][number];
type Operation = Proposal['operations'][number];

export type FactStatus = 'none' | 'verified' | 'unverified';
export type OperationReview = {
  index: number;
  activityId: string;
  title: string;
  previousTitle?: string;
  removed: boolean;
  reason: string;
  sources: Record<SourceKind, number>;
  /** 공식 출처가 밝힌 확인 날짜. 없으면 수집 날짜만 보이고 확인으로 표시하지 않는다. */
  checkedAt?: string;
  collectedAt?: string;
  factStatus: FactStatus;
  needsConfirmation: boolean;
  droppedLegs: string[];
  conflicts: string[];
  warnings: string[];
};

function clockOf(time: Item['time']['start'] | undefined) {
  return time && (time.precision === 'local' || time.precision === 'instant') ? time.localTime.slice(0, 5) : null;
}

function sameTime(a: Item, b: Item) {
  return (
    a.dayId === b.dayId &&
    clockOf(a.time.start) === clockOf(b.time.start) &&
    clockOf(a.time.end) === clockOf(b.time.end)
  );
}

function legMinutes(text: string | undefined) {
  if (!text) {
    return 0;
  }
  const hours = /(\d+)\s*시간/.exec(text);
  const minutes = /(\d+)\s*분/.exec(text);
  return (hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0);
}

function operationReasons(evidence: Evidence[]): Record<string, string> {
  const row = evidence.find((entry) => entry.payload.sourceUrlOrRef === operationReasonsRef);
  try {
    return row?.payload.claim ? (JSON.parse(row.payload.claim) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** 이 변경으로 앞뒤 활동·이동과 어긋나는 점. 표시만 하며 다시 계산하지 않는다. */
function scheduleConflicts(item: Item, plan: PlanVersion) {
  const start = clockOf(item.time.start);
  if (!start) {
    return [];
  }
  const span = timeSpan(start, clockOf(item.time.end));
  const conflicts: string[] = [];
  plan.items
    .filter((other) => other.dayId === item.dayId && other.activityId !== item.activityId)
    .forEach((other) => {
      const otherStart = clockOf(other.time.start);
      if (!otherStart) {
        return;
      }
      const otherSpan = timeSpan(otherStart, clockOf(other.time.end));
      if (span.start < otherSpan.end && otherSpan.start < span.end) {
        conflicts.push(`${other.title}(${otherStart}) 시간과 겹칩니다.`);
      }
    });
  plan.legs
    .filter((leg) => leg.fromActivityId === item.activityId || leg.toActivityId === item.activityId)
    .forEach((leg) => {
      const leaving = leg.fromActivityId === item.activityId;
      const neighbor = plan.items.find((i) => i.activityId === (leaving ? leg.toActivityId : leg.fromActivityId));
      const neighborClock = neighbor
        ? leaving
          ? clockOf(neighbor.time.start)
          : (clockOf(neighbor.time.end) ?? clockOf(neighbor.time.start))
        : null;
      if (!neighbor || !neighborClock) {
        return;
      }
      const gap = leaving ? toMinutes(neighborClock) - span.end : span.start - toMinutes(neighborClock);
      const needed = legMinutes(leg.durationText);
      if (gap < needed) {
        conflicts.push(`${neighbor.title}까지 이동(${leg.durationText ?? leg.mode}) 시간이 부족합니다.`);
      }
    });
  return conflicts;
}

function droppedLegs(activityId: string, plan: PlanVersion) {
  const titleOf = (id: string) => plan.items.find((item) => item.activityId === id)?.title ?? id;
  return plan.legs
    .filter((leg) => leg.fromActivityId === activityId || leg.toActivityId === activityId)
    .map((leg) => `${titleOf(leg.fromActivityId)} → ${titleOf(leg.toActivityId)} (${leg.mode})`);
}

function reviewOne(
  operation: Operation,
  index: number,
  proposal: Proposal,
  plan: PlanVersion,
  evidence: Evidence[],
  reasons: Record<string, string>,
): OperationReview {
  const activityId = operation.type === 'remove-item' ? operation.activityId : operation.item.activityId;
  const old = plan.items.find((item) => item.activityId === activityId);
  const next = operation.type === 'upsert-item' ? operation.item : undefined;
  const reason = reasons[activityId] ?? proposal.reason;
  const web = evidence.filter((entry) => entry.payload.sourceType === 'web');
  // 항목을 지정하지 않은 근거는 변경안 전체의 근거로 본다.
  const linked = old
    ? web.filter(
        (entry) =>
          entry.payload.relatedRefs.length === 0 ||
          entry.payload.relatedRefs.some((ref) => ref.targetKind === 'activity' && ref.entityId === activityId),
      )
    : web;
  const official = officialHosts(plan);
  const kinds = linked.map((entry) => classifySource(entry.payload.sourceUrlOrRef, official));
  const sources: Record<SourceKind, number> = {
    official: kinds.filter((kind) => kind === 'official').length,
    press: kinds.filter((kind) => kind === 'press').length,
    community: kinds.filter((kind) => kind === 'community').length,
  };
  const volatile = linked.filter((entry) => isVolatileFact(entry.payload.claim ?? ''));
  const textIsVolatile = isVolatileFact(`${next?.summary ?? ''} ${reason}`);
  const confirmed = (entry: Evidence) =>
    classifySource(entry.payload.sourceUrlOrRef, official) === 'official' && Boolean(entry.payload.sourceVerifiedAt);
  let factStatus: FactStatus = 'none';
  if (volatile.length || textIsVolatile) {
    const allConfirmed = volatile.length > 0 && volatile.every(confirmed);
    factStatus = allConfirmed ? 'verified' : 'unverified';
  }
  const checkedDates = linked.flatMap((entry) => {
    const verified = entry.payload.sourceVerifiedAt;
    return verified && 'date' in verified && verified.date ? [verified.date] : [];
  });
  const collectedDates = linked.flatMap((entry) =>
    entry.payload.collectedAt ? [entry.payload.collectedAt.slice(0, 10)] : [],
  );
  const moved = Boolean(old && next && old.dayId !== next.dayId);
  const booked = Boolean(old && old.bookingIds.length > 0);
  const timeChanged = Boolean(old && next && !sameTime(old, next));
  const warnings: string[] = [];
  if (next && isUnrealisticTime(clockOf(next.time.start))) {
    warnings.push(`${clockOf(next.time.start)}은 비현실적인 시각일 수 있습니다.`);
  }
  return {
    index,
    activityId,
    title: next?.title ?? old?.title ?? activityId,
    previousTitle: next ? (old?.title ?? '새 활동') : undefined,
    removed: operation.type === 'remove-item',
    reason,
    sources,
    checkedAt: checkedDates.toSorted().at(-1),
    collectedAt: collectedDates.toSorted().at(-1),
    factStatus,
    needsConfirmation: booked && (operation.type === 'remove-item' || timeChanged),
    droppedLegs: operation.type === 'remove-item' || moved ? droppedLegs(activityId, plan) : [],
    // 날짜를 옮기면 이동이 함께 사라지므로 이동 시간은 비교하지 않는다.
    conflicts: next && (!old || timeChanged) ? scheduleConflicts(next, moved ? { ...plan, legs: [] } : plan) : [],
    warnings,
  };
}

export function reviewProposal(proposal: Proposal, plan: PlanVersion, evidence: ContentRevision[]): OperationReview[] {
  const rows = evidence.filter((entry): entry is Evidence => entry.kind === 'evidence');
  const reasons = operationReasons(rows);
  return proposal.operations.map((operation, index) => reviewOne(operation, index, proposal, plan, rows, reasons));
}

/** 일괄 적용에 넣을 항목. 확인 필요 항목은 사용자가 따로 표시한 것만 들어간다. */
export function operationsToApply(reviews: OperationReview[], confirmed: ReadonlySet<string>) {
  return reviews.filter((review) => !review.needsConfirmation || confirmed.has(review.activityId));
}

/** 확인 표시는 활동 ID에 묶고 revision별로 둔다. 재적용으로 revision이 바뀌면 다시 체크해야 한다. */
export type ConfirmationState = { revisionId: string; activityIds: ReadonlySet<string> };

export function confirmationsFor(state: ConfirmationState, revisionId: string): ReadonlySet<string> {
  return state.revisionId === revisionId ? state.activityIds : new Set();
}

export function withConfirmation(
  state: ConfirmationState,
  revisionId: string,
  activityId: string,
  value: boolean,
): ConfirmationState {
  const next = new Set(confirmationsFor(state, revisionId));
  if (value) {
    next.add(activityId);
  } else {
    next.delete(activityId);
  }
  return { revisionId, activityIds: next };
}
