// 자정을 넘는 일정. 종료가 시작보다 이르면 다음 날로 해석하고, 12시간을 넘으면 입력 오류로 본다.
import { expect, it } from 'vitest';
import { buildAiV2Payload } from '../src/ai-v2-context';
import { materializeV2Proposal, validateAiV2Output } from '../src/ai-v2-semantics';
import { reviewProposal } from '../src/content/proposal-review';
import { timeRangeReversal, type ContentRevision, type Proposal } from '../src/contracts/v2';
import { aiV2Fixture } from './fixtures/ai-v2';

type Fixture = Awaited<ReturnType<typeof aiV2Fixture>>;

function night(fixture: Fixture, startTime = '23:00', endTime = '00:30', dayId = fixture.input.planning.days[0].dayId) {
  const output = structuredClone(fixture.output);
  output.operations[0] = {
    ...output.operations[0],
    type: 'add',
    activityId: '',
    dayId,
    placeId: null,
    startTime,
    endTime,
  };
  return output;
}

it('23:00~00:30은 다음 날로 넘어간 90분 일정으로 허용한다', async () => {
  const fixture = await aiV2Fixture();
  expect(() => validateAiV2Output(fixture.input.planning, night(fixture), fixture.research.sources)).not.toThrow();
});

it('다음 날 00:00 고정 활동과 겹치면 거부한다', async () => {
  const fixture = await aiV2Fixture();
  const planning = structuredClone(fixture.input.planning);
  const next = planning.items.find((item) => item.dayId === planning.days[1].dayId)!;
  next.start = '00:00';
  next.end = null;
  next.fixed = true;
  expect(() => validateAiV2Output(planning, night(fixture), fixture.research.sources)).toThrow('겹칩니다');
});

it('다음 날 첫 활동이나 도착 시각을 넘어가면 거부한다', async () => {
  const fixture = await aiV2Fixture();
  const first = structuredClone(fixture.input.planning);
  first.items.find((item) => item.dayId === first.days[1].dayId)!.start = '00:15';
  expect(() => validateAiV2Output(first, night(fixture), fixture.research.sources)).toThrow('겹칩니다');
  const arrival = structuredClone(fixture.input.planning);
  arrival.items = arrival.items.filter((item) => item.dayId !== arrival.days[1].dayId);
  arrival.days[1].arrival = '00:15';
  expect(() => validateAiV2Output(arrival, night(fixture), fixture.research.sources)).toThrow('도착');
});

it('다음 날이 선택 범위 밖이어도 그날의 첫 시각과 비교한다', async () => {
  const fixture = await aiV2Fixture();
  const plan = fixture.dataset.plans[0];
  const day = plan.days[0];
  const nextItem = plan.items.find((item) => item.dayId === plan.days[1].dayId)!;
  nextItem.time = {
    start: { precision: 'local', date: plan.days[1].date, localTime: '00:10', timeZoneStatus: 'unknown' },
  };
  const { planning } = buildAiV2Payload(fixture.dataset, {
    prompt: '요청',
    requestKind: 'add',
    fromDate: day.date,
    count: 1,
  });
  expect(planning.days).toHaveLength(1);
  expect(() => validateAiV2Output(planning, night(fixture), fixture.research.sources)).toThrow('겹칩니다');
});

it('전날 자정을 넘는 고정 활동과 겹치는 이른 시각을 거부한다', async () => {
  const fixture = await aiV2Fixture();
  const planning = structuredClone(fixture.input.planning);
  const [first] = planning.items;
  first.start = '23:00';
  first.end = '00:30';
  first.fixed = true;
  const output = night(fixture, '00:10', '00:20', planning.days[1].dayId);
  expect(() => validateAiV2Output(planning, output, fixture.research.sources)).toThrow('고정 활동');
});

it.each([
  ['09:00', '08:00'],
  ['17:59', '06:00'],
])('%s~%s는 12시간을 넘어 입력 오류로 거부한다', async (start, end) => {
  const fixture = await aiV2Fixture();
  expect(() =>
    validateAiV2Output(fixture.input.planning, night(fixture, start, end), fixture.research.sources),
  ).toThrow('자정을 넘는 일정은 12시간 이내');
});

it('정확히 12시간은 허용한다', async () => {
  const fixture = await aiV2Fixture();
  const planning = structuredClone(fixture.input.planning);
  planning.items = planning.items.filter((item) => item.dayId !== planning.days[1].dayId);
  expect(() => validateAiV2Output(planning, night(fixture, '18:00', '06:00'), fixture.research.sources)).not.toThrow();
});

it('저장될 종료 시각은 다음 날짜라 새 쓰기 검증의 역전으로 잡히지 않는다', async () => {
  const fixture = await aiV2Fixture();
  const { proposal } = materializeV2Proposal(fixture.local, night(fixture), fixture.research);
  const operation = proposal.operations[0];
  if (operation.type !== 'upsert-item') {
    throw new Error('추가 항목이어야 합니다.');
  }
  expect(operation.item.time.end).toMatchObject({ date: '2026-11-01', localTime: '00:30' });
  expect(timeRangeReversal(operation.item.time)).toBeUndefined();
});

it('카드의 시간 충돌도 자정을 넘긴 길이로 계산한다', async () => {
  const fixture = await aiV2Fixture();
  const plan = structuredClone(fixture.local.plan);
  const other = plan.items.find((item) => item.activityId === 'activity-2')!;
  const date = plan.days[0].date;
  other.time = { start: { precision: 'local', date, localTime: '23:30', timeZoneStatus: 'unknown' } };
  const local = { ...fixture.local, plan };
  const { proposal, evidence } = materializeV2Proposal(local, night(fixture, '22:00', '00:30'), fixture.research);
  const reviews = reviewProposal({ ...proposal, commitSeq: 1 } as Proposal, plan, evidence as ContentRevision[]);
  expect(reviews[0].conflicts.join()).toContain('겹칩니다');
});
