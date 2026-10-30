import type { ContentRevision } from '../contracts/v2';

type Guide = Extract<ContentRevision, { kind: 'guide' }>;
const isGuide = (content: ContentRevision): content is Guide => content.kind === 'guide';

/** 앱에서 직접 작성한 가이드는 가져온 원천 출처가 없다. 원천처럼 보이는 ID를 흉내 내지 않고 이 사실로 구분한다. */
export function isAuthoredGuide(content: ContentRevision) {
  return isGuide(content) && content.sourceRefs.length === 0;
}

/** 준비 화면의 읽을 자료 목록에 올릴지 결정한다. 가져온 준비 문서는 기존 기준(원천 ID·첨부)을 그대로 따른다. */
export function isReadingGuide(content: ContentRevision) {
  return (
    isGuide(content) &&
    content.payload.documentKind !== 'place-guide' &&
    (content.payload.documentKind !== 'preparation' ||
      isAuthoredGuide(content) ||
      content.entityId.startsWith('source-common-prose-') ||
      content.entityId.startsWith('source-document-') ||
      content.payload.sections.some((section) => section.assetRefs.length > 0))
  );
}

/** 섹션을 고칠 수 있는 가이드: 장소·지역 가이드와 앱에서 작성한 여행 공통 가이드. 구조화 문서와 가져온 준비 문서는 제외한다. */
export function isEditableGuide(content: ContentRevision) {
  if (!isGuide(content)) {
    return false;
  }
  const kind = content.payload.documentKind;
  return kind === 'place-guide' || kind === 'region-guide' || (kind === 'preparation' && isAuthoredGuide(content));
}
