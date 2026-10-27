import { expect, it } from 'vitest';
import { notesForTarget, type NoteRecord } from '../src/content/Notes';

const target = { tripId: 'trip-a', targetKind: 'activity', entityId: 'activity-1' } as const;
function note(recordId: string, commitSeq: number, ref: NoteRecord['payload']['targetRef'] = target): NoteRecord {
  return {
    tripId: ref.tripId,
    recordId,
    kind: 'note',
    recordedAt: '2026-10-27T00:00:00Z',
    sourceRefs: [],
    commitSeq,
    payload: { targetRef: ref, body: `가상 메모 ${recordId}`, contextRefs: [] },
  };
}

it('같은 활동 메모를 계획 버전에 걸쳐 찾고 다른 대상·유형·여행 메모를 섞지 않는다', () => {
  const records = [
    note('old-plan', 1, { ...target, planVersionId: 'plan-1' }),
    note('new-plan', 2, { ...target, planVersionId: 'plan-2' }),
    note('other-activity', 3, { ...target, entityId: 'activity-2' }),
    note('other-kind', 4, { ...target, targetKind: 'booking' }),
    note('other-trip', 5, { ...target, tripId: 'trip-b' }),
  ];
  expect(notesForTarget(records, target).map((record) => record.recordId)).toEqual(['new-plan', 'old-plan']);
});

it('정정된 메모는 최신 기록만 표시하고 다른 여행의 같은 ID 정정에 영향을 받지 않는다', () => {
  const original = note('same-id', 1);
  const foreign = { ...note('foreign-correction', 2, { ...target, tripId: 'trip-b' }), supersedes: 'same-id' };
  expect(notesForTarget([original, foreign], target)).toEqual([original]);
  const correction = { ...note('own-correction', 3), supersedes: 'same-id' };
  expect(notesForTarget([original, foreign, correction], target)).toEqual([correction]);
});

it('기기 시각이 앞뒤로 바뀌어도 저장 순서로 표시하고 원본 배열을 바꾸지 않는다', () => {
  const first = note('first', 1);
  first.recordedAt = '2026-10-27T12:00:00Z';
  const second = note('second', 2);
  second.recordedAt = '2026-10-26T12:00:00Z';
  const records = [first, second];
  expect(notesForTarget(records, target)).toEqual([second, first]);
  expect(records).toEqual([first, second]);
});
