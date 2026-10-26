import { buildAiV2Request } from '../../src/ai-v2-context';
import type { AiV2Output } from '../../src/ai-v2-contract';
import type { Research } from '../../server/ai';
import { pilotTrip } from './pilot';

export async function aiV2Fixture() {
  const dataset = await pilotTrip();
  dataset.plans[0].items[0].reservationText = 'SYNTHETIC-PRIVATE-RESERVATION';
  dataset.plans[0].items[0].executionNote = 'SYNTHETIC-PRIVATE-FIELD-NOTE';
  dataset.plans[0].items[0].mapTargetId = 'map-place';
  const input = buildAiV2Request(dataset, '가상 일정의 순서를 조정해 주세요.', dataset.header.startDate, 3, false);
  const item = input.context.plan.items[0];
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
        startTime: null,
        endTime: null,
        placeId: item.placeLinks[0].placeId,
      },
    ],
    evidence: [{ url: research.sources[0].url, claim: '가상 자료의 주장' }],
  };
  return { dataset, input, output, research };
}
