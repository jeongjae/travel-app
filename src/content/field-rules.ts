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
