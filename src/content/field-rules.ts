import { canonicalJson } from '../contracts/v2/json';
import type { FieldRecord, RevisionRef, TimeSpec } from '../contracts/v2';

export type ActualRecord = Extract<FieldRecord, { kind: 'actual' }>;
type ActualPayload = ActualRecord['payload'];

export type ActualEdits = {
  title: string;
  outcome: ActualPayload['outcome'];
  note: string;
  start: TimeSpec;
  /** 선택한 장소 ID. 빈 문자열이면 장소 없음. */
  placeId: string;
  tripId: string;
};

/**
 * 폼 입력과 원본 기록으로 새 기록의 payload를 만든다(C-04).
 * 편집하지 않은 필드(종료 시각, 시각 정밀도·instant·offset, 장소, 계획/활동 연결, 맥락)는 원본 값을 그대로 가져온다.
 * 정정에서 장소를 바꿨을 때만 맥락에 새 장소의 현재 revision을 더한다.
 */
export function actualPayload(
  original: ActualRecord | undefined,
  edits: ActualEdits,
  baseContext: RevisionRef[],
  currentContext: RevisionRef[],
  link?: { planVersionId: string; activityId: string },
): ActualPayload {
  const before = original?.payload;
  const startChanged = !before || canonicalJson(before.time.start) !== canonicalJson(edits.start);
  const time =
    before && !startChanged
      ? before.time
      : { ...(before?.time.end ? { end: before.time.end } : {}), start: edits.start };
  const placeChanged = (before?.placeRef?.entityId ?? '') !== edits.placeId;
  const placeRef = placeChanged
    ? edits.placeId
      ? { tripId: edits.tripId, targetKind: 'place' as const, entityId: edits.placeId }
      : undefined
    : before?.placeRef;
  const contextRefs =
    placeChanged && edits.placeId ? contextWithPlace(baseContext, currentContext, edits.placeId) : baseContext;
  const planLink = before?.planVersionId
    ? { planVersionId: before.planVersionId, ...(before.activityId ? { activityId: before.activityId } : {}) }
    : (link ?? {});
  return {
    title: edits.title,
    targetSummary: before?.targetSummary ?? edits.title,
    outcome: edits.outcome,
    time,
    note: edits.note,
    contextRefs,
    ...planLink,
    ...(placeRef ? { placeRef } : {}),
  };
}

/**
 * 원본 맥락을 유지하면서 선택한 장소의 현재 revision을 고정한다.
 * 원본에 없던 연결 대상(지역·본문 등)은 현재 head에서 보충하고, 원본에 이미 있던 항목은 당시 revision을 유지한다.
 */
export function contextWithPlace(base: RevisionRef[], current: RevisionRef[], placeId: string): RevisionRef[] {
  const keyOf = (ref: RevisionRef) => `${ref.targetKind}/${ref.entityId}`;
  const place = current.find((ref) => ref.targetKind === 'place' && ref.entityId === placeId);
  if (!place) {
    return base;
  }
  const kept = base.filter((ref) => !(ref.targetKind === 'place' && ref.entityId === placeId));
  const known = new Set(kept.map(keyOf));
  const added = current.filter((ref) => !known.has(keyOf(ref)) && keyOf(ref) !== keyOf(place));
  return [...kept, place, ...added];
}

export type ChainLink = {
  /** 이 기록이 정정한 이전 기록. 원본이면 없다. */
  before?: ActualRecord;
  /** 이 기록을 정정한 다음 기록. 최신이면 없다. */
  after?: ActualRecord;
  /** 원본부터 센 순번(원본=1). */
  position: number;
  /** 이 정정 체인의 전체 길이. */
  length: number;
};

/** 정정 체인에서 각 실제 기록의 앞뒤 연결을 계산한다. 체인이 길어도 순회로 모두 이어 읽는다. */
export function correctionLinks(records: FieldRecord[]): Map<string, ChainLink> {
  const actuals = records.filter((r): r is ActualRecord => r.kind === 'actual');
  const byId = new Map(actuals.map((r) => [r.recordId, r]));
  const next = new Map<string, ActualRecord>();
  for (const record of actuals) {
    if (record.supersedes) {
      next.set(record.supersedes, record);
    }
  }
  const links = new Map<string, ChainLink>();
  for (const record of actuals) {
    if (record.supersedes && byId.has(record.supersedes)) {
      continue;
    }
    const chain: ActualRecord[] = [];
    for (
      let cursor: ActualRecord | undefined = record;
      cursor && !chain.includes(cursor);
      cursor = next.get(cursor.recordId)
    ) {
      chain.push(cursor);
    }
    chain.forEach((item, index) => {
      const before = chain[index - 1];
      const after = chain[index + 1];
      links.set(item.recordId, {
        position: index + 1,
        length: chain.length,
        ...(before ? { before } : {}),
        ...(after ? { after } : {}),
      });
    });
  }
  return links;
}

/** 정정 체인을 원본부터 최신까지 순서대로 모은다. 체인 순서는 원본의 commitSeq 순서다. */
export function actualChains(records: FieldRecord[]): ActualRecord[][] {
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

export type ActualChainEntry = {
  /** 최신 정정본. 목록에는 이 기록 한 행만 보인다. */
  latest: ActualRecord;
  /** 원본부터 최신까지. 정정하지 않았으면 길이 1. */
  chain: ActualRecord[];
};

export type ActualDayGroup = {
  /** 최신 정정본의 발생일(YYYY-MM-DD). */
  date: string;
  /** 시각이 있는 기록은 시각 순, 시각을 모르는 기록은 그 뒤에 기록한 순서대로. */
  entries: ActualChainEntry[];
};

export type ActualGrouping = {
  days: ActualDayGroup[];
  /** 최신 정정본의 발생일을 모르는 기록. 날짜를 추정하지 않고 따로 모은다. */
  unknown: ActualChainEntry[];
};

const clockOf = (record: ActualRecord) => {
  const start = record.payload.time.start;
  return start.precision === 'local' || start.precision === 'instant' ? start.localTime : undefined;
};

/** 실제 기록을 정정 체인 단위로 묶어 날짜별로 나눈다(읽기 전용 표시 모델). 기록은 바꾸지 않는다. */
export function groupActualsByDate(records: FieldRecord[]): ActualGrouping {
  const entries = actualChains(records).map((chain) => ({ latest: chain[chain.length - 1], chain }));
  const byDate = new Map<string, ActualChainEntry[]>();
  const unknown: ActualChainEntry[] = [];
  for (const entry of entries) {
    const date = entry.latest.payload.time.start.date;
    if (!date) {
      unknown.push(entry);
      continue;
    }
    byDate.set(date, [...(byDate.get(date) ?? []), entry]);
  }
  const byTime = (a: ActualChainEntry, b: ActualChainEntry) => {
    const clockA = clockOf(a.latest);
    const clockB = clockOf(b.latest);
    if (clockA && clockB && clockA !== clockB) {
      return clockA.localeCompare(clockB);
    }
    if (Boolean(clockA) !== Boolean(clockB)) {
      return clockA ? -1 : 1;
    }
    return a.latest.commitSeq - b.latest.commitSeq;
  };
  return {
    days: [...byDate]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([date, rows]) => ({ date, entries: rows.toSorted(byTime) })),
    unknown,
  };
}

export type DayRecordView = {
  /** 계획 항목(activityId)에 연결된 최신 정정본. 항목 카드에 한 줄 배지로 보인다. */
  byActivity: Map<string, ActualRecord>;
  /** 이 날짜의 계획 항목에 연결되지 않은 기록. 타임라인에 기록 전용 카드로 넣는다. */
  standalone: ActualChainEntry[];
  /** 전용 카드 중 다른 날 계획 항목에 연결된 기록의 계획 날짜(recordId → YYYY-MM-DD). 보조 문구에 쓴다. */
  plannedOn: Map<string, string>;
};

/**
 * C-12 C8: 오늘 타임라인에 함께 보일 실제 기록을 고른다(읽기 전용). 기록도 계획 항목도 바꾸지 않는다.
 * 항목에 연결된 기록은 그 날짜와 상관없이 항목의 최신 기록 하나만 배지로 쓰고,
 * 이 날짜에 발생했지만 현재 계획의 항목에 연결되지 않은 기록(예정 외 활동, 제거된 항목의 기록)은 전용 카드로 모은다.
 */
export function dayRecordView(
  records: FieldRecord[],
  activityIds: ReadonlySet<string>,
  date: string,
  activityDates: ReadonlyMap<string, string> = new Map(),
): DayRecordView {
  const entries = actualChains(records).map((chain) => ({ latest: chain[chain.length - 1], chain }));
  const byActivity = new Map<string, ActualRecord>();
  for (const { latest } of entries.toSorted((a, b) => a.latest.commitSeq - b.latest.commitSeq)) {
    const activityId = latest.payload.activityId;
    if (activityId && activityIds.has(activityId)) {
      byActivity.set(activityId, latest);
    }
  }
  const plannedOn = new Map<string, string>();
  const standalone = entries.filter(({ latest }) => {
    if (latest.payload.time.start.date !== date) {
      return false;
    }
    const linked = latest.payload.activityId;
    if (!(linked && activityIds.has(linked))) {
      return true;
    }
    // 항목이 다른 날 계획에 있고 기록이 이 날짜로 정정된 경우: 이 날짜에도 기록 카드를 둔다.
    const plannedDate = activityDates.get(linked);
    if (plannedDate && plannedDate !== date) {
      plannedOn.set(latest.recordId, plannedDate);
      return true;
    }
    return false;
  });
  return { byActivity, standalone: standalone.toSorted(compareByClock), plannedOn };
}

function compareByClock(a: ActualChainEntry, b: ActualChainEntry) {
  const clockA = clockOf(a.latest);
  const clockB = clockOf(b.latest);
  if (clockA && clockB && clockA !== clockB) {
    return clockA.localeCompare(clockB);
  }
  if (Boolean(clockA) !== Boolean(clockB)) {
    return clockA ? -1 : 1;
  }
  return a.latest.commitSeq - b.latest.commitSeq;
}

export type TimelinePlacement = {
  /** 이 항목(activityId) 카드 바로 앞에 놓을 기록 카드. */
  before: Map<string, ActualChainEntry[]>;
  /** 어느 항목보다도 늦거나 시각이 없는 기록. 그날 맨 아래에 놓는다. */
  trailing: ActualChainEntry[];
};

/**
 * 기록 전용 카드를 계획 항목 사이의 시각 순서에 맞춰 끼워 넣을 자리를 정한다.
 * 시각이 있는 기록은 그보다 늦은 시각의 첫 항목 앞에, 항목이 없거나 더 늦은 항목이 없으면 맨 아래에 둔다.
 * 시각이 없는 기록은 항상 맨 아래이며 항목의 순서(order)는 건드리지 않는다.
 */
export function placeOnTimeline(
  items: ReadonlyArray<{ activityId: string; time: { start: TimeSpec } }>,
  standalone: ActualChainEntry[],
): TimelinePlacement {
  const before = new Map<string, ActualChainEntry[]>();
  const trailing: ActualChainEntry[] = [];
  for (const entry of standalone) {
    const clock = clockOf(entry.latest);
    const target = clock
      ? items.find((item) => {
          const start = item.time.start;
          return (start.precision === 'local' || start.precision === 'instant') && start.localTime > clock;
        })
      : undefined;
    if (target) {
      before.set(target.activityId, [...(before.get(target.activityId) ?? []), entry]);
    } else {
      trailing.push(entry);
    }
  }
  return { before, trailing };
}
