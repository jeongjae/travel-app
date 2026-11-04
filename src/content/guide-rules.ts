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

type Region = Extract<ContentRevision, { kind: 'region' }>;
type Place = Extract<ContentRevision, { kind: 'place' }>;

export type GuideRegionGroup = {
  region: Region;
  /** 이 지역에 속한 장소. 장소가 여러 지역에 속하면 각 지역 아래에 나타난다. */
  places: Place[];
};

export type GuideGrouping = {
  regions: GuideRegionGroup[];
  /** 어느 지역에도 속하지 않은(또는 지역을 찾을 수 없는) 장소. */
  unassigned: Place[];
  /** 검색어가 있을 때 남은 지역·장소 수의 합. 0이면 일치하는 것이 없다. */
  matchCount: number;
};

/**
 * 가이드 목록을 지역별로 묶는다(읽기 전용 모델). 검색어는 장소 이름과 소속 지역 이름, 지역 이름에 적용한다.
 * 일치하는 장소가 있거나 지역 이름이 일치하는 지역만 남기고, 지역 없는 장소는 이름이 일치할 때만 남긴다.
 */
export function groupGuideCatalog(catalog: ContentRevision[], query: string): GuideGrouping {
  const regions = catalog.filter((c): c is Region => c.kind === 'region');
  const places = catalog.filter((c): c is Place => c.kind === 'place');
  const regionById = new Map(regions.map((r) => [r.entityId, r]));
  const needle = query.trim();
  const placeMatches = (place: Place) =>
    `${place.payload.name} ${place.payload.regionIds.map((id) => regionById.get(id)?.payload.name ?? '').join(' ')}`.includes(
      needle,
    );
  const groups = regions
    .map((region) => ({
      region,
      places: places.filter((p) => p.payload.regionIds.includes(region.entityId) && placeMatches(p)),
    }))
    .filter((group) => !needle || group.places.length || group.region.payload.name.includes(needle));
  const unassigned = places.filter((p) => !p.payload.regionIds.some((id) => regionById.has(id)) && placeMatches(p));
  return {
    regions: groups,
    unassigned,
    matchCount: groups.length + groups.reduce((sum, g) => sum + g.places.length, 0) + unassigned.length,
  };
}
