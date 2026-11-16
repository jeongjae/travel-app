import promptDocument from '../../docs/plan-format-v1-prompt.md?raw';

const DIVIDER = '---';

/**
 * 안내문 문서에서 첫 `---` 줄과 마지막 `---` 줄 사이의 글만 꺼낸다.
 * 챗봇에게 주는 글은 이 문서 한 곳에서만 관리하고, 앱은 빌드 때 `?raw`로 읽어 온다.
 */
export function extractFormatPrompt(document: string): string {
  const lines = document.replace(/\r\n?/g, '\n').split('\n');
  const first = lines.findIndex((line) => line.trim() === DIVIDER);
  const last = lines.findLastIndex((line) => line.trim() === DIVIDER);
  if (first === -1 || last <= first) {
    throw new Error('양식 안내문 문서에서 두 개의 --- 줄을 찾지 못했습니다.');
  }
  return lines
    .slice(first + 1, last)
    .join('\n')
    .trim();
}

export const PLAN_FORMAT_PROMPT = extractFormatPrompt(promptDocument);
