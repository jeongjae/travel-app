import { expect, it } from 'vitest';
import { aiV2PlanningDtoSchema } from '../src/ai-v2-contract';
import { buildAiV2Payload, consentedRequest } from '../src/ai-v2-context';
import { AiV2RequestError, checkAiV2Request } from '../src/ai-v2-jobs-core';
import { materializeV2Proposal } from '../src/ai-v2-semantics';
import { aiV2Fixture } from './fixtures/ai-v2';

it('전송 컨텍스트에서 예약·숙박 상세와 기본 현장 기록을 제외하고 원본을 유지한다', async () => {
  const { dataset } = await aiV2Fixture();
  const before = structuredClone(dataset);
  const selection = { prompt: '가상 요청', requestKind: 'edit' as const };
  const request = buildAiV2Payload(dataset, { ...selection, fromDate: dataset.plans[0].days[1].date, count: 99 });
  expect(request.planning.days).toHaveLength(2);
  expect(request.planning.items.every((item) => item.dayId !== 'day-1')).toBe(true);
  expect(request.planning).not.toHaveProperty('stays');
  expect(request.planning).not.toHaveProperty('contextRefs');
  expect(request.planning.records).toEqual([]);
  const encoded = JSON.stringify(
    buildAiV2Payload(dataset, { ...selection, fromDate: dataset.header.startDate, count: 3 }),
  );
  expect(encoded).not.toContain('SYNTHETIC-PRIVATE-RESERVATION');
  expect(encoded).not.toContain('SYNTHETIC-PRIVATE-FIELD-NOTE');
  expect(encoded).not.toContain('privateDetails');
  const actual = dataset.records.find((record) => record.recordId === 'actual-1');
  if (actual?.kind === 'actual') {
    actual.payload.time = { start: { precision: 'date', date: dataset.header.startDate } };
  }
  const beforeRecords = structuredClone(dataset);
  const withRecords = buildAiV2Payload(dataset, {
    ...selection,
    fromDate: dataset.header.startDate,
    count: 3,
    recordIds: ['actual-1'],
  });
  expect(withRecords.planning.records.map((record) => record.id)).toEqual(['actual-1']);
  expect(dataset).toEqual(beforeRecords);
  expect(before.plans).toEqual(dataset.plans);
});

it('시각 미지정 편집은 기존 시각을 유지하고 장소 교체 시 과거 좌표 참조를 제거한다', async () => {
  const { local, output, research } = await aiV2Fixture();
  const same = materializeV2Proposal(local, output, research);
  expect(same.proposal.status).toBe('pending');
  expect(same.proposal.baseDomainRevision).toBe(local.baseDomainRevision + 1);
  expect(same.proposal.operations[0]).toMatchObject({ item: { time: local.plan.items[0].time } });
  output.operations[0].placeId = 'place-2';
  const changed = materializeV2Proposal(local, output, research);
  expect(changed.proposal.operations[0]).toMatchObject({ item: { placeLinks: [{ placeId: 'place-2' }] } });
  expect(changed.proposal.operations[0]).not.toHaveProperty('item.mapTargetId');
  expect(changed.evidence[0].payload).not.toHaveProperty('sourceVerifiedAt');
});

it('새 활동 추가에 기존 활동 ID를 사용해 예약·작업 참조를 복제하지 못한다', async () => {
  const { local, output, research } = await aiV2Fixture();
  output.operations[0].type = 'add';
  expect(() => materializeV2Proposal(local, output, research)).toThrow('활동 ID');
  output.operations[0].activityId = '';
  const result = materializeV2Proposal(local, output, research);
  expect(result.proposal.operations[0]).toMatchObject({ item: { bookingIds: [], taskRefs: [] } });
});

it.each(['unknown-day', 'unknown-place', 'unknown-activity', 'duplicate-activity', 'invented-source'])(
  '%s인 AI 변경안을 로컬에서 거부한다',
  async (invalid) => {
    const { local, output, research } = await aiV2Fixture();
    if (invalid === 'unknown-day') {
      output.operations[0].dayId = 'missing-day';
    } else if (invalid === 'unknown-place') {
      output.operations[0].placeId = 'missing-place';
    } else if (invalid === 'unknown-activity') {
      output.operations[0].activityId = 'missing-activity';
    } else if (invalid === 'duplicate-activity') {
      output.operations.push(structuredClone(output.operations[0]));
    } else {
      output.evidence[0].url = 'https://example.org/not-researched';
    }
    expect(() => materializeV2Proposal(local, output, research)).toThrow();
  },
);

it('여행·계획 참조와 날짜 범위가 어긋난 요청은 검사에서 거부한다', async () => {
  const { dataset, policy } = await aiV2Fixture();
  const day = dataset.plans[0].days[0];
  const make = async (change: (planning: ReturnType<typeof buildAiV2Payload>['planning']) => void) => {
    const payload = buildAiV2Payload(dataset, {
      prompt: '가상 요청',
      requestKind: 'edit',
      fromDate: day.date,
      count: 3,
    });
    change(payload.planning);
    return consentedRequest(payload, policy);
  };
  const otherDay = await make((planning) => {
    planning.items[0].dayId = 'other-day';
  });
  await expect(checkAiV2Request(otherDay, policy)).rejects.toThrow('여행·계획');
  const early = await make((planning) => {
    planning.fromDate = '2001-01-01';
  });
  await expect(checkAiV2Request(early, policy)).rejects.toBeInstanceOf(AiV2RequestError);
});

it('blocked 시각이 HH:MM이 아니면 계약이 거부한다', async () => {
  const { input } = await aiV2Fixture();
  const planning = structuredClone(input.planning);
  planning.days[0].blocked = [{ from: '9시', to: '10:00' }];
  expect(() => aiV2PlanningDtoSchema.parse(planning)).toThrow();
  planning.days[0].blocked = [{ from: '09:00', to: '10:00' }];
  expect(() => aiV2PlanningDtoSchema.parse(planning)).not.toThrow();
});
