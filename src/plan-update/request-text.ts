/** 40,000자를 넘으면 챗봇이 다루기 어려우므로 날짜 범위를 권한다. */
export const LARGE_EXPORT_LIMIT = 40000;

export const REQUEST_PLACEHOLDER = '[요청] (여기에 고칠 내용을 적으세요)';

export type RequestKind = 'free' | 'fill-blanks';

export const REQUEST_KIND_LABEL: Record<RequestKind, string> = { free: '자유 요청', 'fill-blanks': '빈 칸 채우기' };

/** "빈 칸 채우기"를 고르면 `[요청]` 줄에 들어가는 글. 가져오기 양식·검사는 바꾸지 않는다. */
export const FILL_BLANKS_REQUEST =
  '일정의 시간·제목·순서는 바꾸지 말고, 비어 있는 메모·링크 칸만 채워 줘. ' +
  '장소 칸이 비어 있는 활동에 맞는 장소가 있으면 장소 칸에 이름을 적고, ## 장소 표에 ID 없는 새 줄로 ' +
  '설명·영업시간·링크를 적어 줘. ID가 있는 장소 줄은 비어 있는 칸만 채우고 이름은 바꾸지 말아 줘. ' +
  '확인되지 않은 것은 채우지 말고, 코드 블록 밖에 따로 적어 줘.';

/** 요청 종류에 맞는 `[요청]` 줄의 글. 자유 요청은 비워 둔다(자리 표시가 보인다). */
export function requestTextOf(kind: RequestKind) {
  return kind === 'fill-blanks' ? FILL_BLANKS_REQUEST : '';
}

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
