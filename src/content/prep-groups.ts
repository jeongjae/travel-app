import type { ContentRevision, PlanVersion } from '../contracts/v2';
import { guideDisplayTitle, guideRegion, regionDisplayName, stripCommonPrefix } from './display-names';

/**
 * 준비·회화 단추 묶음(C-15). 여행 전체 자료를 맨 위에, 지역 자료를 여행 순서대로 둔다. 표시 규칙만 정하고 저장값은 건드리지 않는다.
 */

type Guide = Extract<ContentRevision, { kind: 'guide' }>;
type Region = Extract<ContentRevision, { kind: 'region' }>;
type Day = PlanVersion['days'][number];

export type PrepEntry = { content: Guide; label: string };
export type PrepSection = {
  key: string;
  /** 여행 전체 절은 `여행 전체`, 지역 절은 지역 표시 이름. */
  title: string;
  regionId?: string;
  entries: PrepEntry[];
};

/** 여행 전체 자료의 고정 순서: 이용법 → 하이라이트 → 전체 일정 → 예약 → 긴급 연락처 → 그 밖 → 회화. */
function tripWideRank(guide: Guide): number {
  const title = guide.payload.title;
  if (guide.payload.documentKind === 'language-guide') {
    return 90;
  }
  const ordered: [RegExp, number][] = [
    [/이용하는 법|사용하는 법|이용법/, 10],
    [/하이라이트/, 20],
    [/전체 일정|마스터 일정/, 30],
    [/예약/, 40],
    [/긴급 연락/, 50],
  ];
  return ordered.find(([pattern]) => pattern.test(title))?.[1] ?? 60;
}

/** 지역 절 안의 고정 순서: 지역 가이드 → 생활·도착·귀가 → 교통권 → 그 밖. */
function regionRank(guide: Guide): number {
  switch (guide.payload.documentKind) {
    case 'region-guide':
      return 0;
    case 'preparation':
      return 1;
    case 'region-essentials':
      return 2;
    case 'transit':
      return 3;
    default:
      return 4;
  }
}

/** 지역의 여행 순서: 일정 날짜 순으로 처음 등장하는 날(없으면 맨 뒤). */
export function regionTravelOrder(regions: Region[], days: Day[]): Region[] {
  const firstSeen = new Map<string, number>();
  days
    .toSorted((a, b) => a.date.localeCompare(b.date) || a.ordinal - b.ordinal)
    .forEach((day, index) => {
      for (const id of [...day.regionIds, ...(day.overnightRegionId ? [day.overnightRegionId] : [])]) {
        if (!firstSeen.has(id)) {
          firstSeen.set(id, index);
        }
      }
    });
  const position = (region: Region) => firstSeen.get(region.entityId) ?? Number.MAX_SAFE_INTEGER;
  return regions.toSorted((a, b) => position(a) - position(b) || a.payload.name.localeCompare(b.payload.name, 'ko'));
}

/** 지역 절 머리말에 이름이 이미 있으므로 단추 글자에서 지역 접두를 뺀다. */
function withoutRegionPrefix(label: string, region: Region): string {
  const prefix = `${regionDisplayName(region.payload.name)} · `;
  return label.startsWith(prefix) ? label.slice(prefix.length) : label;
}

export function prepSections(guides: Guide[], regions: Region[], days: Day[]): PrepSection[] {
  const tripWide: Guide[] = [];
  const byRegion = new Map<string, Guide[]>();
  for (const guide of guides) {
    const region = guideRegion(guide, regions);
    if (!region) {
      tripWide.push(guide);
      continue;
    }
    byRegion.set(region.entityId, [...(byRegion.get(region.entityId) ?? []), guide]);
  }
  const sections: PrepSection[] = [];
  if (tripWide.length) {
    sections.push({
      key: 'trip',
      title: '여행 전체',
      entries: tripWide
        .toSorted((a, b) => tripWideRank(a) - tripWideRank(b))
        .map((content) => ({ content, label: stripCommonPrefix(guideDisplayTitle(content.payload.title)) })),
    });
  }
  for (const region of regionTravelOrder(regions, days)) {
    const owned = byRegion.get(region.entityId);
    if (!owned?.length) {
      continue;
    }
    sections.push({
      key: region.entityId,
      title: regionDisplayName(region.payload.name),
      regionId: region.entityId,
      entries: owned
        .toSorted((a, b) => regionRank(a) - regionRank(b))
        .map((content) => ({
          content,
          label: withoutRegionPrefix(guideDisplayTitle(content.payload.title, region), region),
        })),
    });
  }
  return sections;
}
