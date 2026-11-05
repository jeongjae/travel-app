import type { ContentRevision } from '../contracts/v2';

/**
 * 표시 전용 이름 규칙(C-14). 저장된 이름·제목은 바꾸지 않고 화면에 보일 때만 줄이거나 구분한다.
 */

const MAX_TRIP_NAME = 40;

/** 이름 끝의 `Day 1·2·…·N` 나열은 `(N일)`로, 그 밖의 긴 이름은 한 줄 말줄임으로 줄인다. */
export function tripDisplayName(name: string): string {
  const listed = /\s*Day\s+(\d+(?:\s*[·,]\s*\d+)+)\s*$/.exec(name);
  const shortened = listed
    ? `${name.slice(0, listed.index)} (${listed[1].split(/[·,]/).length}일)`.trim()
    : name.trim();
  return shortened.length > MAX_TRIP_NAME ? `${shortened.slice(0, MAX_TRIP_NAME - 1).trimEnd()}…` : shortened;
}

/** 지역 이름이 원천 키처럼 소문자로만 되어 있으면 첫 글자만 대문자로 보인다. 표시 이름이 있으면 그대로 쓴다. */
export function regionDisplayName(name: string): string {
  if (/^[a-z][a-z\s'’·-]*$/.test(name)) {
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  return name;
}

type Guide = Extract<ContentRevision, { kind: 'guide' }>;
type Region = Extract<ContentRevision, { kind: 'region' }>;

/** 원천 파일 경로 `…/09_Avignon_Alpilles_Pont_du_Gard_v2.0.md`에서 읽을 수 있는 이름을 뽑는다. */
function sourceLabel(path: string): string {
  const base = (path.split('/').at(-1) ?? path).replace(/\.[a-z0-9]+$/i, '');
  return base
    .replace(/^\d+[A-Z]?_/, '')
    .replace(/_v\d+(?:\.\d+)*$/, '')
    .replace(/_/g, ' ')
    .trim();
}

/** 제목이 원천 키(`aix · 지역 가이드`)처럼 소문자 이름으로 시작하면 그 이름만 첫 글자를 대문자로 보인다. */
function keyedTitle(title: string): string {
  const match = /^([a-z][a-z-]*)( · .*)$/.exec(title);
  return match ? `${regionDisplayName(match[1])}${match[2]}` : title;
}

export type GuideLabel = { content: Guide; label: string; group: string };

/**
 * 같은 제목의 가이드가 둘 이상이면 소유 지역 이름(없으면 원천 파일 이름에서 찾은 지역, 그것도 없으면 원천 이름)을
 * 앞에 붙인다. 제목이 하나뿐이면 그대로 둔다. 결과는 묶음 이름, 제목 순이다.
 */
export function guideLabels(guides: Guide[], regions: Region[]): GuideLabel[] {
  const regionById = new Map(regions.map((region) => [region.entityId, region]));
  const titleCount = new Map<string, number>();
  for (const guide of guides) {
    titleCount.set(guide.payload.title, (titleCount.get(guide.payload.title) ?? 0) + 1);
  }
  const groupOf = (guide: Guide): string => {
    const owner = guide.payload.ownerRef;
    if (owner.targetKind === 'region') {
      const region = regionById.get(owner.entityId);
      return regionDisplayName(region?.payload.name ?? owner.entityId);
    }
    const path = guide.sourceRefs[0]?.sourcePath ?? '';
    const normalized = sourceLabel(path).toLowerCase().replace(/\s+/g, ' ');
    const matched = regions.find((region) => normalized.split(' ').includes(region.entityId.toLowerCase()));
    if (matched) {
      return regionDisplayName(matched.payload.name);
    }
    return path ? sourceLabel(path) : '';
  };
  const anyDuplicate = [...titleCount.values()].some((count) => count > 1);
  const labels = guides.map((content) => {
    const group = groupOf(content);
    const duplicated = (titleCount.get(content.payload.title) ?? 0) > 1;
    const title = keyedTitle(content.payload.title);
    return {
      content,
      group,
      label: duplicated && group ? `${group} · ${title}` : title,
    };
  });
  return anyDuplicate
    ? labels.sort((a, b) => a.group.localeCompare(b.group, 'ko') || a.label.localeCompare(b.label, 'ko'))
    : labels;
}

/** 기록의 앱 저장 시각(ISO)을 기기 현지 `M/D HH:mm`로 보인다. 해석할 수 없으면 원문 그대로 둔다. */
export function localClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
