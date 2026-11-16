import { describe, expect, it } from 'vitest';
import { AI_APPLY_BLOCKED_MESSAGE, applyBlockReason, BLOCK_AI_PROPOSAL_APPLY } from '../src/content/ai-apply-block';

describe('AI 변경안 적용 차단', () => {
  it('origin이 ai인 변경안만 막는다', () => {
    expect(BLOCK_AI_PROPOSAL_APPLY).toBe(true);
    expect(applyBlockReason({ origin: 'ai' })).toBe(AI_APPLY_BLOCKED_MESSAGE);
    expect(applyBlockReason({ origin: 'user' })).toBeUndefined();
    expect(applyBlockReason({ origin: 'import' })).toBeUndefined();
  });

  it('차단 사유 문장에 확인·거절은 가능하다는 안내가 있다', () => {
    expect(AI_APPLY_BLOCKED_MESSAGE).toContain('개편 중이라 막아 두었습니다');
    expect(AI_APPLY_BLOCKED_MESSAGE).toContain('내용 확인과 거절은 가능합니다');
  });
});
