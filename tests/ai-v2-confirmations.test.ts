// R4: 확인 표시는 활동 ID에 묶이고, 변경안 revision이 바뀌면 모두 지워져 다시 체크해야 한다.
import { expect, it } from 'vitest';
import { materializeV2Proposal } from '../src/ai-v2-semantics';
import {
  confirmationsFor,
  operationsToApply,
  reviewProposal,
  withConfirmation,
  type ConfirmationState,
} from '../src/content/proposal-review';
import type { ContentRevision, Proposal } from '../src/contracts/v2';
import { aiV2Fixture } from './fixtures/ai-v2';

async function threeBooked() {
  const fixture = await aiV2Fixture();
  const plan = structuredClone(fixture.local.plan);
  const ids = ['activity-1', 'activity-2', 'activity-3'];
  ids.forEach((id) => {
    plan.items.find((item) => item.activityId === id)!.bookingIds = ['booking-code'];
  });
  const output = structuredClone(fixture.output);
  output.operations = ids.map((id, index) => {
    const item = plan.items.find((candidate) => candidate.activityId === id)!;
    return {
      ...fixture.output.operations[0],
      activityId: id,
      dayId: item.dayId,
      placeId: null,
      title: id,
      startTime: `1${index}:00`,
    };
  });
  output.evidence[0].operationIndexes = [];
  const { proposal, evidence } = materializeV2Proposal({ ...fixture.local, plan }, output, fixture.research);
  const full = { ...proposal, commitSeq: 1 } as Proposal;
  const review = (candidate: Proposal) => reviewProposal(candidate, plan, evidence as ContentRevision[]);
  return { full, review };
}

const empty = (revisionId: string): ConfirmationState => ({ revisionId, activityIds: new Set() });

it('목록 순서·개수가 바뀌어도 표시는 같은 활동에 남는다', async () => {
  const { full, review } = await threeBooked();
  const state = withConfirmation(empty('rev-1'), 'rev-1', 'activity-2', true);
  const confirmed = confirmationsFor(state, 'rev-1');
  const kept = (candidate: Proposal) => operationsToApply(review(candidate), confirmed).map((row) => row.activityId);
  expect(kept(full)).toEqual(['activity-2']);
  const shorter = { ...full, operations: full.operations.slice(1) };
  expect(kept(shorter)).toEqual(['activity-2']);
  const reversed = { ...full, operations: full.operations.toReversed() };
  expect(kept(reversed)).toEqual(['activity-2']);
});

it('재적용으로 revision이 바뀌면 표시가 모두 지워져 다시 체크해야 적용된다', async () => {
  const { full, review } = await threeBooked();
  const state = withConfirmation(empty('rev-1'), 'rev-1', 'activity-2', true);
  const narrowed = { ...full, operations: full.operations.slice(1) };
  expect(narrowed.operations).toHaveLength(2);
  const cleared = confirmationsFor(state, 'rev-2');
  expect(cleared.size).toBe(0);
  expect(operationsToApply(review(narrowed), cleared)).toEqual([]);
  const rechecked = withConfirmation(state, 'rev-2', 'activity-3', true);
  expect([...confirmationsFor(rechecked, 'rev-2')]).toEqual(['activity-3']);
  expect(
    operationsToApply(review(narrowed), confirmationsFor(rechecked, 'rev-2')).map((row) => row.activityId),
  ).toEqual(['activity-3']);
});

it('체크를 풀면 그 활동만 빠진다', async () => {
  const { full, review } = await threeBooked();
  let state = withConfirmation(empty('rev-1'), 'rev-1', 'activity-1', true);
  state = withConfirmation(state, 'rev-1', 'activity-2', true);
  state = withConfirmation(state, 'rev-1', 'activity-1', false);
  expect(operationsToApply(review(full), confirmationsFor(state, 'rev-1')).map((row) => row.activityId)).toEqual([
    'activity-2',
  ]);
});
