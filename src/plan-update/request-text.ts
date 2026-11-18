/** 40,000자를 넘으면 챗봇이 다루기 어려우므로 날짜 범위를 권한다. */
export const LARGE_EXPORT_LIMIT = 40000;

export const REQUEST_PLACEHOLDER = '[요청] (여기에 고칠 내용을 적으세요)';

/** "AI로 수정하기"로 복사하는 글: 안내 + 요청 자리 + 내보내기 글. */
export function buildUpdateRequest(exportedText: string, request = '') {
  const requestLine = request.trim() === '' ? REQUEST_PLACEHOLDER : `[요청] ${request.trim()}`;
  return [
    '아래는 travel-app에 저장된 최신 여행 계획이다. 이것을 기준으로 내 요청대로 고쳐 줘.',
    '바뀐 부분만 같은 형식의 markdown 코드 블록 하나로 돌려줘. 규칙은 아래 글 안에 있다.',
    '',
    requestLine,
    '',
    exportedText,
  ].join('\n');
}
