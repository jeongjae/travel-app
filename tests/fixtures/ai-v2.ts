import { buildAiV2Payload, consentedRequest } from '../../src/ai-v2-context';
import { aiV2Limits, aiV2LocalServer, type AiV2Output, type AiV2Policy } from '../../src/ai-v2-contract';
import { toValidationScope, type AiV2LocalContext } from '../../src/ai-v2-semantics';
import type { Research } from '../../server/ai';
import { pilotTrip } from './pilot';

export const fictionalPolicy = (model = 'fictional-v2-provider'): AiV2Policy => ({
  server: aiV2LocalServer,
  model,
  limits: { ...aiV2Limits },
});

export async function aiV2Fixture() {
  const dataset = await pilotTrip();
  dataset.plans[0].items[0].reservationText = 'SYNTHETIC-PRIVATE-RESERVATION';
  dataset.plans[0].items[0].executionNote = 'SYNTHETIC-PRIVATE-FIELD-NOTE';
  dataset.plans[0].items[0].mapTargetId = 'map-place';
  const policy = fictionalPolicy();
  const payload = buildAiV2Payload(dataset, {
    prompt: '가상 일정의 순서를 조정해 주세요.',
    requestKind: 'edit',
    fromDate: dataset.header.startDate,
    count: 3,
  });
  const input = await consentedRequest(payload, policy);
  const item = input.planning.items[0];
  const research: Research = {
    text: '가상 공식 자료이며 실제 웹 조사를 실행하지 않았습니다.',
    sources: [{ url: 'https://example.org/fictional-official', title: '가상 공식 자료' }],
  };
  const output: AiV2Output = {
    reason: '가상 조사에 따른 검증용 조정',
    reservationImpact: '실제 예약 변경 없음',
    operations: [
      {
        type: 'edit',
        activityId: item.activityId,
        dayId: item.dayId,
        title: '가상 AI 변경 활동',
        summary: '사용자 확인 전의 가상 변경안',
        reason: '가상 항목 사유',
        startTime: null,
        endTime: null,
        placeId: item.placeId,
      },
    ],
    evidence: [{ url: research.sources[0].url, claim: '가상 자료의 주장', checkedAt: null, operationIndexes: [0] }],
  };
  const local: AiV2LocalContext = {
    id: input.id,
    tripId: dataset.header.tripId,
    baseDomainRevision: dataset.header.domainRevision,
    plan: dataset.plans[0],
    scope: toValidationScope(input.planning),
    collectedAt: '2026-01-05T00:00:00.000Z',
  };
  return { dataset, payload, policy, input, local, output, research };
}
