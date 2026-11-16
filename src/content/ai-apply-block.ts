import type { Proposal } from '../contracts/v2';

/** AI 개편(CL-39) 동안 AI가 만든 변경안의 적용을 막는다. 되돌리려면 이 값을 false로 바꾼다. */
export const BLOCK_AI_PROPOSAL_APPLY = true;

export const AI_APPLY_BLOCKED_MESSAGE = 'AI 변경안 적용은 개편 중이라 막아 두었습니다. 내용 확인과 거절은 가능합니다.';

/** 적용을 막는 사유. 막지 않으면 undefined. 단추 표시와 적용 함수가 같은 함수를 쓴다. */
export function applyBlockReason(proposal: Pick<Proposal, 'origin'>): string | undefined {
  return BLOCK_AI_PROPOSAL_APPLY && proposal.origin === 'ai' ? AI_APPLY_BLOCKED_MESSAGE : undefined;
}
