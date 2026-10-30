import { canonicalJson } from '../contracts/v2/json';
import type { FieldRecord, TripDataset } from '../contracts/v2/index';

type Fail = (code: string, message: string) => never;
type Actual = Extract<FieldRecord, { kind: 'actual' }>;

/**
 * 실제 기록(RecordActual/CorrectActual)의 장소 연결·정정 보존 규칙(C-04).
 * 새로 연결하는 장소는 이 여행의 활성 장소여야 하고, 기록의 맥락이 그 장소의 현재 revision을 고정해야 한다.
 * 이미 연결된 장소는 나중에 비활성이 되어도 정정에서 그대로 유지할 수 있다.
 * 정정은 원본의 계획/활동 연결과 원천(sourceRefs)을 바꾸지 못한다.
 */
export function guardActualRecord(t: TripDataset, row: Actual, previous: Actual | undefined, fail: Fail) {
  function must(ok: unknown, code: string, message: string): asserts ok {
    if (!ok) {
      fail(code, message);
    }
  }
  const placeRef = row.payload.placeRef;
  if (placeRef && placeRef.entityId !== previous?.payload.placeRef?.entityId) {
    must(placeRef.tripId === t.header.tripId, 'BROKEN_REFERENCE', '다른 여행의 장소는 연결할 수 없습니다.');
    const head = t.heads.find((h) => h.targetKind === 'place' && h.entityId === placeRef.entityId);
    must(head, 'BROKEN_REFERENCE', '없는 장소는 연결할 수 없습니다.');
    must(head.status === 'active', 'BROKEN_REFERENCE', '비활성 장소는 새로 연결할 수 없습니다.');
    const pinned = row.payload.contextRefs.find(
      (ref) => ref.targetKind === 'place' && ref.entityId === placeRef.entityId,
    );
    must(
      pinned?.revisionId === head.revisionId,
      'BROKEN_REFERENCE',
      '장소의 현재 본문 revision을 기록 맥락에 고정해야 합니다.',
    );
  }
  if (previous) {
    must(
      previous.payload.planVersionId === row.payload.planVersionId &&
        previous.payload.activityId === row.payload.activityId,
      'INVALID_INPUT',
      '정정은 원본의 계획 항목 연결을 바꿀 수 없습니다.',
    );
    must(
      canonicalJson(previous.sourceRefs) === canonicalJson(row.sourceRefs),
      'INVALID_INPUT',
      '정정은 원본의 원천 정보를 바꿀 수 없습니다.',
    );
  }
}
