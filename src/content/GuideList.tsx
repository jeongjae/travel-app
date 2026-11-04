import type { ContentRevision } from '../contracts/v2';
import { groupGuideCatalog } from './guide-rules';

type Place = Extract<ContentRevision, { kind: 'place' }>;
type Region = Extract<ContentRevision, { kind: 'region' }>;

/** 지역 머리의 설명 한 줄: 한 줄 소개가 없으면 지역 설명의 첫 줄. */
const oneLine = (region: Region) => region.payload.tagline || region.payload.introduction?.split('\n')[0] || '';

/**
 * 가이드 첫 화면: 지역 머리(이름·설명·지역 가이드 수) 아래에 소속 장소를 늘어놓고, 지역 없는 장소를 맨 아래에 둔다.
 * 읽기 전용이며 열기만 부모에 알린다. 지역 가이드 작성은 지역 상세 안에서만 한다.
 */
export function GuideList({
  catalog,
  search,
  onClearSearch,
  onOpen,
}: {
  catalog: ContentRevision[];
  search: string;
  onClearSearch: () => void;
  onOpen: (kind: 'place' | 'region', id: string) => void;
}) {
  const grouping = groupGuideCatalog(catalog, search);
  if (!grouping.matchCount) {
    return (
      <p className="notice guide-empty">
        일치하는 장소가 없습니다 ·{' '}
        <button type="button" onClick={onClearSearch}>
          검색어 지우기
        </button>
      </p>
    );
  }
  const placeRow = (place: Place, keyPrefix: string) => (
    <li key={`${keyPrefix}-${place.entityId}`} className="guide-place-row">
      <button type="button" onClick={() => onOpen('place', place.entityId)}>
        {place.payload.name}
      </button>
      <span className="muted">{place.payload.summary}</span>
      {place.payload.gradeLabel ? <span className="journey-label">{place.payload.gradeLabel}</span> : null}
    </li>
  );
  return (
    <div className="guide-regions">
      {grouping.regions.map(({ region, places }) => (
        <section key={region.entityId} className="guide-region">
          <header className="guide-region-head">
            <h3>
              <button type="button" onClick={() => onOpen('region', region.entityId)}>
                {region.payload.name}
              </button>
            </h3>
            {oneLine(region) ? <p className="muted">{oneLine(region)}</p> : null}
            <p className="muted">
              지역 가이드 {region.payload.guideIds.length}개 · 장소 {places.length}곳
            </p>
          </header>
          {places.length ? (
            <ul>{places.map((place) => placeRow(place, region.entityId))}</ul>
          ) : (
            <p className="muted">이 지역에 연결된 장소가 없습니다.</p>
          )}
        </section>
      ))}
      {grouping.unassigned.length ? (
        <section className="guide-region">
          <header className="guide-region-head">
            <h3>지역 없는 장소</h3>
          </header>
          <ul>{grouping.unassigned.map((place) => placeRow(place, 'none'))}</ul>
        </section>
      ) : null}
    </div>
  );
}
