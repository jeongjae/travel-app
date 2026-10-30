import { canonicalJson } from '../contracts/v2/json';
import type { FieldRecord, PlanVersion, Proposal, RevisionRef, TripDataset } from '../contracts/v2';
import { correctionLinks, type ActualRecord } from './field-rules';

/**
 * C-05 T-C6: 날짜별 회고 조회 모델. 저장소에서 읽은 TripDataset만 입력으로 받는 순수 함수이며 아무것도 쓰지 않는다.
 * 현재 값을 과거 버전의 값처럼 섞지 않고, 연결 데이터가 없으면 추정하지 않고 "연결 없음"으로 남긴다.
 */
export const UNKNOWN_DATE = 'unknown';

type Day = PlanVersion['days'][number];
type Item = PlanVersion['items'][number];
type Stay = PlanVersion['stays'][number];
type Leg = PlanVersion['legs'][number];

export type RetroDates = {
  /** 계획(어느 버전이든)이나 실제 기록이 있는 날짜, 오름차순. */
  dates: string[];
  /** 대표 기록 중 날짜를 알 수 없는 것이 있는지. */
  hasUnknown: boolean;
};

export type PlanDayView = {
  day: Day;
  items: Item[];
  legs: (Leg & { fromTitle: string; toTitle: string })[];
  stays: Stay[];
};

export type PlanColumn = {
  planVersionId: string;
  number: number;
  isCurrent: boolean;
  reason: string;
  /** 이 계획 버전이 고정한 콘텐츠 revision. 당시 본문을 열 때 쓴다. */
  contextRefs: RevisionRef[];
  /** 이 날짜가 이 계획 버전에 없으면 빈 배열. */
  days: PlanDayView[];
};

export type PlanLinkView =
  | { kind: 'none' }
  | {
      kind: 'linked';
      planVersionId: string;
      /** 연결된 계획 버전 번호. 계획이 저장소에 없으면 undefined. */
      planNumber?: number;
      activityId?: string;
      /** 연결한 계획 버전 안의 항목 제목. 항목을 찾지 못하면 undefined. */
      itemTitle?: string;
      /** 그 계획 버전에서 항목이 속한 날짜. */
      plannedDate?: string;
      /** 실제 날짜와 계획일이 둘 다 알려져 있고 서로 다를 때만 true. */
      dateDiffers: boolean;
      /** 현재 계획에 같은 활동이 있는지. activityId가 없으면 undefined. */
      inCurrentPlan?: boolean;
    };

export type ActualEntry = {
  /** 최신 정정본(대표 기록). */
  latest: ActualRecord;
  /** 원본부터 최신까지. */
  chain: ActualRecord[];
  planLink: PlanLinkView;
  /** 정정으로 날짜가 옮겨진 경우 앞선 기록들의 서로 다른 날짜. 날짜 미상은 'unknown'. */
  earlierDates: string[];
};

export type MovedAway = {
  /** 이 날짜로 기록했다가 정정으로 옮겨진 정정 체인. */
  entry: ActualEntry;
  /** 지금 대표 기록의 날짜. 미상이면 'unknown'. */
  movedTo: string;
};

export type ReasonView = {
  planVersionId: string;
  number: number;
  /** 이 계획 버전이 회고에서 맡는 역할. */
  roles: ('selected' | 'current' | 'linked-by-record')[];
  reason: string;
  createdAt: string;
  parent?: { planVersionId: string; number: number };
  /** 첫 계획이면 true(비교할 이전 버전 없음). */
  initial: boolean;
  /** 계획이 변경안 적용으로 만들어졌는지. */
  source: 'applied-proposal' | 'proposal-missing' | 'stored-reason-only';
  proposal?: {
    proposalId: string;
    proposalRevisionId: string;
    origin: Proposal['origin'];
    reason: string;
    decidedAt?: string;
    evidenceRefs: RevisionRef[];
    impactActivityIds: string[];
    reservationText: string;
  };
  /** 이 날짜가 직전 계획 버전과 비교해 바뀌었는지. 이유는 계획 전체에 대한 것이다. */
  dayChange: 'initial' | 'unchanged' | 'changed' | 'added-day' | 'removed-day' | 'no-day';
  /** 이 날짜에서 직전 버전과 달라진 활동 ID. */
  changedActivityIds: string[];
  /** 변경안이 영향 대상으로 명시한 활동 중 이 날짜에 있는 것. */
  impactOnDate: string[];
};

export type RetroView = {
  date: string;
  unknownDate: boolean;
  currentPlanVersionId: string;
  selectedPlanVersionId: string;
  columns: PlanColumn[];
  entries: ActualEntry[];
  movedAway: MovedAway[];
  reasons: ReasonView[];
  summary: { visited: number; skipped: number; unplanned: number; corrected: number };
};

const dateOf = (record: ActualRecord) => record.payload.time.start.date;

function actualChains(records: FieldRecord[]): ActualRecord[][] {
  const actuals = records.filter((r): r is ActualRecord => r.kind === 'actual');
  const known = new Set(actuals.map((r) => r.recordId));
  const links = correctionLinks(records);
  return actuals
    .filter((r) => !r.supersedes || !known.has(r.supersedes))
    .map((root) => {
      const chain: ActualRecord[] = [];
      for (
        let cursor: ActualRecord | undefined = root;
        cursor && !chain.includes(cursor);
        cursor = links.get(cursor.recordId)?.after
      ) {
        chain.push(cursor);
      }
      return chain;
    })
    .toSorted((a, b) => a[0].commitSeq - b[0].commitSeq);
}

function planLinkOf(trip: TripDataset, record: ActualRecord): PlanLinkView {
  const { planVersionId, activityId } = record.payload;
  if (!planVersionId) {
    return { kind: 'none' };
  }
  const plan = trip.plans.find((p) => p.planVersionId === planVersionId);
  const item = activityId ? plan?.items.find((i) => i.activityId === activityId) : undefined;
  const plannedDate = item ? plan?.days.find((d) => d.dayId === item.dayId)?.date : undefined;
  const actualDate = dateOf(record);
  const current = trip.plans.find((p) => p.planVersionId === trip.header.currentPlanVersionId);
  return {
    kind: 'linked',
    planVersionId,
    ...(plan ? { planNumber: plan.number } : {}),
    ...(activityId ? { activityId } : {}),
    ...(item ? { itemTitle: item.title } : {}),
    ...(plannedDate ? { plannedDate } : {}),
    dateDiffers: Boolean(plannedDate && actualDate && plannedDate !== actualDate),
    ...(activityId ? { inCurrentPlan: Boolean(current?.items.some((i) => i.activityId === activityId)) } : {}),
  };
}

function entryOf(trip: TripDataset, chain: ActualRecord[]): ActualEntry {
  const latest = chain[chain.length - 1];
  const latestDate = dateOf(latest) ?? UNKNOWN_DATE;
  const earlier = chain.slice(0, -1).map((r) => dateOf(r) ?? UNKNOWN_DATE);
  return {
    latest,
    chain,
    planLink: planLinkOf(trip, latest),
    earlierDates: [...new Set(earlier.filter((d) => d !== latestDate))],
  };
}

/** 선택할 수 있는 날짜 목록. 여러 계획 버전의 날짜와 실제 기록의 날짜(대표 기록 기준)를 합친다. */
export function retrospectiveDates(trip: TripDataset): RetroDates {
  const dates = new Set<string>();
  for (const plan of trip.plans) {
    plan.days.forEach((day) => dates.add(day.date));
  }
  let hasUnknown = false;
  for (const chain of actualChains(trip.records)) {
    chain.forEach((record) => {
      const date = dateOf(record);
      if (date) {
        dates.add(date);
      }
    });
    if (!dateOf(chain[chain.length - 1])) {
      hasUnknown = true;
    }
  }
  return { dates: [...dates].toSorted(), hasUnknown };
}

function dayViews(plan: PlanVersion, date: string): PlanDayView[] {
  return plan.days
    .filter((day) => day.date === date)
    .map((day) => {
      const items = plan.items.filter((i) => i.dayId === day.dayId).toSorted((a, b) => a.order - b.order);
      const titleOf = (activityId: string) =>
        plan.items.find((i) => i.activityId === activityId)?.title ?? '삭제된 활동';
      return {
        day,
        items,
        legs: plan.legs
          .filter((l) => l.dayId === day.dayId)
          .map((l) => ({ ...l, fromTitle: titleOf(l.fromActivityId), toTitle: titleOf(l.toActivityId) })),
        stays: plan.stays.filter((stay) => {
          const start = stay.time.start.date;
          const end = stay.time.end?.date ?? start;
          return Boolean(start && end && start <= date && date <= end);
        }),
      };
    });
}

function column(trip: TripDataset, plan: PlanVersion, date: string): PlanColumn {
  return {
    planVersionId: plan.planVersionId,
    number: plan.number,
    isCurrent: plan.planVersionId === trip.header.currentPlanVersionId,
    reason: plan.reason,
    contextRefs: plan.contextRefs,
    days: dayViews(plan, date),
  };
}

const itemsOnDate = (plan: PlanVersion | undefined, date: string) => {
  const dayIds = new Set(plan?.days.filter((d) => d.date === date).map((d) => d.dayId));
  return plan?.items.filter((i) => dayIds.has(i.dayId)) ?? [];
};
const stripPlan = ({ planVersionId: _planVersionId, ...rest }: Item) => rest;

function reasonOf(trip: TripDataset, plan: PlanVersion, date: string, roles: ReasonView['roles']): ReasonView {
  const parent = plan.parentId ? trip.plans.find((p) => p.planVersionId === plan.parentId) : undefined;
  // proposalId만으로 최신 revision을 고르면 대기/거절 revision을 잘못 쓴다. 결과 계획이 이 버전인 적용 revision만 쓴다.
  const applied = plan.proposalId
    ? trip.proposals.find(
        (p) =>
          p.proposalId === plan.proposalId && p.status === 'applied' && p.resultPlanVersionId === plan.planVersionId,
      )
    : undefined;
  const hereItems = itemsOnDate(plan, date);
  const beforeItems = itemsOnDate(parent, date);
  const hasDay = plan.days.some((d) => d.date === date);
  const parentHasDay = Boolean(parent?.days.some((d) => d.date === date));
  const changed = new Set<string>();
  for (const item of hereItems) {
    const old = beforeItems.find((i) => i.activityId === item.activityId);
    if (!old || canonicalJson(stripPlan(old)) !== canonicalJson(stripPlan(item))) {
      changed.add(item.activityId);
    }
  }
  for (const old of beforeItems) {
    if (!hereItems.some((i) => i.activityId === old.activityId)) {
      changed.add(old.activityId);
    }
  }
  let dayChange: ReasonView['dayChange'];
  if (!parent) {
    dayChange = plan.parentId ? 'no-day' : 'initial';
  } else if (!hasDay && !parentHasDay) {
    dayChange = 'no-day';
  } else if (hasDay && !parentHasDay) {
    dayChange = 'added-day';
  } else if (!hasDay) {
    dayChange = 'removed-day';
  } else {
    dayChange = changed.size ? 'changed' : 'unchanged';
  }
  const onDate = new Set([...hereItems, ...beforeItems].map((i) => i.activityId));
  return {
    planVersionId: plan.planVersionId,
    number: plan.number,
    roles,
    reason: plan.reason,
    createdAt: plan.createdAt,
    ...(parent ? { parent: { planVersionId: parent.planVersionId, number: parent.number } } : {}),
    initial: !plan.parentId,
    source: applied ? 'applied-proposal' : plan.proposalId ? 'proposal-missing' : 'stored-reason-only',
    ...(applied
      ? {
          proposal: {
            proposalId: applied.proposalId,
            proposalRevisionId: applied.proposalRevisionId,
            origin: applied.origin,
            reason: applied.reason,
            ...(applied.decision ? { decidedAt: applied.decision.decidedAt } : {}),
            evidenceRefs: applied.evidenceRefs,
            impactActivityIds: applied.impact.activityIds,
            reservationText: applied.impact.reservationText,
          },
        }
      : {}),
    dayChange,
    changedActivityIds: [...changed],
    impactOnDate: applied ? applied.impact.activityIds.filter((id) => onDate.has(id)) : [],
  };
}

/**
 * 날짜 하나의 회고를 만든다. date가 UNKNOWN_DATE면 날짜를 알 수 없는 대표 기록만 모은다.
 * selectedPlanVersionId가 없으면 현재 계획을 선택으로 본다. 현재 계획과 다르면 두 열을 따로 돌려준다.
 */
export function buildRetrospective(trip: TripDataset, date: string, selectedPlanVersionId?: string): RetroView {
  const currentId = trip.header.currentPlanVersionId;
  const current = trip.plans.find((p) => p.planVersionId === currentId);
  const selected = trip.plans.find((p) => p.planVersionId === selectedPlanVersionId) ?? current;
  if (!current || !selected) {
    throw new Error('현재 계획을 찾을 수 없습니다.');
  }
  const unknownDate = date === UNKNOWN_DATE;
  const entries: ActualEntry[] = [];
  const movedAway: MovedAway[] = [];
  for (const chain of actualChains(trip.records)) {
    const entry = entryOf(trip, chain);
    const latestDate = dateOf(entry.latest) ?? UNKNOWN_DATE;
    if (latestDate === date) {
      entries.push(entry);
    } else if (!unknownDate && chain.slice(0, -1).some((r) => dateOf(r) === date)) {
      movedAway.push({ entry, movedTo: latestDate });
    }
  }
  const columns = [column(trip, selected, date)];
  if (selected.planVersionId !== current.planVersionId) {
    columns.unshift(column(trip, current, date));
  }
  const reasonPlans = new Map<string, ReasonView['roles']>();
  const addRole = (planVersionId: string, role: ReasonView['roles'][number]) => {
    reasonPlans.set(planVersionId, [...(reasonPlans.get(planVersionId) ?? []), role]);
  };
  if (!unknownDate) {
    addRole(selected.planVersionId, 'selected');
    if (current.planVersionId !== selected.planVersionId) {
      addRole(current.planVersionId, 'current');
    }
  }
  for (const { planLink } of [...entries, ...movedAway.map((m) => m.entry)]) {
    if (planLink.kind !== 'linked' || !trip.plans.some((p) => p.planVersionId === planLink.planVersionId)) {
      continue;
    }
    if (!reasonPlans.get(planLink.planVersionId)?.includes('linked-by-record')) {
      addRole(planLink.planVersionId, 'linked-by-record');
    }
  }
  const reasons = [...reasonPlans]
    .map(([planVersionId, roles]) =>
      reasonOf(
        trip,
        trip.plans.find((p) => p.planVersionId === planVersionId)!,
        date,
        roles,
      ),
    )
    .toSorted((a, b) => a.number - b.number);
  const count = (outcome: ActualRecord['payload']['outcome']) =>
    entries.filter((e) => e.latest.payload.outcome === outcome).length;
  return {
    date,
    unknownDate,
    currentPlanVersionId: currentId,
    selectedPlanVersionId: selected.planVersionId,
    columns,
    entries,
    movedAway,
    reasons,
    summary: {
      visited: count('visited'),
      skipped: count('skipped'),
      unplanned: count('unplanned'),
      corrected: entries.filter((e) => e.chain.length > 1).length,
    },
  };
}
