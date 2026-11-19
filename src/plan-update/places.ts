import type { PlanVersion } from '../contracts/v2';
import type { CheckedPlanFile } from '../plan-import';
import { joinText, PLACE_MARK, placeCellOf, viaTable } from './cells';
import type { UpdateOperation } from './update-types';

type PlanItem = PlanVersion['items'][number];

/** 한 번의 `CreateContentBatch`에 넣는 최대 장소 수(지시서 B1). */
export const PLACE_BATCH_SIZE = 20;

export type CatalogPlace = {
  entityId: string;
  name: string;
  summary: string;
  wikiRef?: string;
  regionIds: string[];
};

export type CatalogRegion = { entityId: string; name: string };

export type PlaceKindCode = 'sight' | 'food' | 'transport' | 'lodging' | 'shopping' | 'spot';

/** 양식의 종류 값 → 장소 종류. 활동의 종류는 저장될 때 변환 없이 글 그대로이므로 그 글을 그대로 판정한다. */
const KIND_BY_CATEGORY: Record<string, PlaceKindCode> = {
  관광: 'sight',
  식사: 'food',
  이동: 'transport',
  숙박: 'lodging',
  쇼핑: 'shopping',
};

export const PLACE_KIND_LABEL: Record<PlaceKindCode, string> = {
  sight: '관광',
  food: '식사',
  transport: '이동',
  lodging: '숙박',
  shopping: '쇼핑',
  spot: '기타',
};

export function placeKindOf(category: string | undefined): PlaceKindCode {
  return KIND_BY_CATEGORY[(category ?? '').trim()] ?? 'spot';
}

const HOURS_TAIL = /\s*\[영업시간\(미확인\): ([^\]]*)\]$/;
const REGION_TAIL = /\s*\[지역: ([^\]]*)\]$/;

function plain(value: string) {
  return value.replace(/\[/g, '(').replace(/\]/g, ')').trim();
}

/** 장소 설명 끝에 지역·영업시간 표시를 붙인다. 순서는 `설명 [지역: 값] [영업시간(미확인): 값]`. 빈 값은 표시를 만들지 않는다. */
export function composePlaceSummary(parts: { description: string; regionText: string; hours: string }) {
  const region = plain(parts.regionText);
  const hours = plain(parts.hours);
  return joinText([
    parts.description.trim(),
    region === '' ? '' : `[지역: ${region}]`,
    hours === '' ? '' : `[영업시간(미확인): ${hours}]`,
  ]);
}

/** 설명 끝의 두 표시를 뗀다. 표시가 없으면 값은 빈 글이다. */
export function splitPlaceSummary(summary: string) {
  let rest = summary.trim();
  let hours = '';
  let regionText = '';
  const hoursMatch = HOURS_TAIL.exec(rest);
  if (hoursMatch) {
    hours = hoursMatch[1].trim();
    rest = rest.slice(0, hoursMatch.index).trim();
  }
  const regionMatch = REGION_TAIL.exec(rest);
  if (regionMatch) {
    regionText = regionMatch[1].trim();
    rest = rest.slice(0, regionMatch.index).trim();
  }
  return { description: rest, regionText, hours };
}

/** 내보내기·비교에 쓰는 장소 한 줄의 칸 값. 지역은 연결된 지역의 이름(첫째), 없으면 설명 끝 표시의 값. */
export function placeCellsOf(place: CatalogPlace, regions: readonly CatalogRegion[]) {
  const { description, regionText, hours } = splitPlaceSummary(place.summary);
  const linkedRegion = place.regionIds
    .map((id) => regions.find((region) => region.entityId === id)?.name)
    .find((name) => name !== undefined);
  return { description, region: linkedRegion ?? regionText, hours, link: place.wikiRef ?? '' };
}

export type PlaceCandidate = {
  /** 고르기에서 쓰는 열쇠(이름). */
  name: string;
  kind: PlaceKindCode;
  region: string;
  description: string;
  hours: string;
  link: string;
  /** 이름이 같은 기존 장소. 있으면 "연결" 후보로 보이고 자동으로 합치지 않는다. */
  existing?: { entityId: string; name: string };
  /** 이 장소를 장소 칸에 적은 활동 수. */
  usedBy: number;
  fromTable: boolean;
  warnings: string[];
};

export type ExistingPlaceLines = { changed: number; unknown: number };

export type PlaceCollection = { candidates: PlaceCandidate[]; existingLines: ExistingPlaceLines };

export type CollectContext = {
  /** 열려 있는 여행의 현재 계획. 새 여행이면 없다. */
  plan?: PlanVersion;
  places: readonly CatalogPlace[];
  regions: readonly CatalogRegion[];
};

function isWebUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

type Use = { date: string; line: number; category: string };

/**
 * 새 장소 후보를 모은다: 장소 표의 ID 없는 줄과, 일정의 장소 칸 중 현재 값과 다른 이름.
 * 같은 이름은 하나로 합치고, 종류는 그 이름을 적은 첫 활동(날짜순, 같은 날은 줄 순서)의 종류로 정한다.
 */
export function collectPlaceCandidates(file: CheckedPlanFile, context: CollectContext): PlaceCollection {
  const { plan, places } = context;
  const placeNames = new Map(places.map((place) => [place.entityId, place.name]));
  const items = new Map((plan?.items ?? []).map((item) => [item.activityId, item]));
  const uses = new Map<string, Use[]>();
  for (const day of file.days) {
    if (day.broken) {
      continue;
    }
    for (const row of day.rows) {
      const name = row.place.trim();
      if (name === '' || row.cleared.includes('장소')) {
        continue;
      }
      const current = row.id === '' ? undefined : items.get(row.id);
      if (current && placeCellOf(current, placeNames) === name) {
        continue;
      }
      const list = uses.get(name) ?? [];
      list.push({ date: day.date, line: row.line, category: row.category });
      uses.set(name, list);
    }
  }
  const existingLines: ExistingPlaceLines = { changed: 0, unknown: 0 };
  const tableRows = new Map<string, CheckedPlanFile['places'][number]>();
  for (const row of file.places) {
    if (row.id !== '' && plan) {
      const known = places.find((place) => place.entityId === row.id);
      if (!known) {
        existingLines.unknown++;
      } else if (differsFromCurrent(row, known, context.regions)) {
        existingLines.changed++;
      }
      continue;
    }
    const name = row.name.trim();
    if (name !== '' && !tableRows.has(name)) {
      tableRows.set(name, row);
    }
  }
  const names = [...new Set([...tableRows.keys(), ...uses.keys()])];
  const candidates = names.map((name) => buildCandidate(name, tableRows.get(name), uses.get(name) ?? [], places));
  return { candidates, existingLines };
}

function differsFromCurrent(
  row: CheckedPlanFile['places'][number],
  place: CatalogPlace,
  regions: readonly CatalogRegion[],
) {
  const current = placeCellsOf(place, regions);
  const pairs: [string, string, string][] = [
    ['이름', row.name, place.name],
    ['지역', row.region, current.region],
    ['설명', row.description, current.description],
    ['영업시간', row.hours, current.hours],
    ['링크', row.link, current.link],
  ];
  return pairs.some(([column, value, now]) => {
    const cleared = row.cleared.includes(column);
    if (cleared) {
      return now !== '';
    }
    return value !== '' && viaTable(value) !== viaTable(now);
  });
}

function buildCandidate(
  name: string,
  row: CheckedPlanFile['places'][number] | undefined,
  used: Use[],
  places: readonly CatalogPlace[],
): PlaceCandidate {
  const first = [...used].sort((a, b) => (a.date === b.date ? a.line - b.line : a.date < b.date ? -1 : 1))[0];
  const match = places.find((place) => place.name.trim() === name);
  const link = row?.link ?? '';
  const warnings: string[] = [];
  if (link !== '' && !isWebUrl(link)) {
    warnings.push(`링크 "${link}"는 http(s) 주소가 아니라 넣지 않습니다.`);
  }
  return {
    name,
    kind: placeKindOf(first?.category),
    region: row?.region ?? '',
    description: row?.description ?? '',
    hours: row?.hours ?? '',
    link: link !== '' && isWebUrl(link) ? link : '',
    ...(match ? { existing: { entityId: match.entityId, name: match.name } } : {}),
    usedBy: used.length,
    fromTable: row !== undefined,
    warnings,
  };
}

/** 이미 들어온 활동의 메모 앞 `[장소: 이름]`을 "장소로 만들기" 후보로 모은다(B2, 새 여행의 연결 단계). */
export function collectMarkCandidates(
  plan: PlanVersion,
  context: Pick<CollectContext, 'places'>,
  details: ReadonlyMap<string, CheckedPlanFile['places'][number]> = new Map(),
): PlaceCandidate[] {
  const dayOrder = new Map(plan.days.map((day) => [day.dayId, day.ordinal]));
  const dayDate = new Map(plan.days.map((day) => [day.dayId, day.date]));
  const ordered = [...plan.items].sort(
    (a, b) => (dayOrder.get(a.dayId) ?? 0) - (dayOrder.get(b.dayId) ?? 0) || a.order - b.order,
  );
  const uses = new Map<string, Use[]>();
  ordered.forEach((item, index) => {
    const marked = PLACE_MARK.exec(item.summary.trim());
    if (!marked) {
      return;
    }
    const name = marked[1].trim();
    const list = uses.get(name) ?? [];
    list.push({ date: dayDate.get(item.dayId) ?? '', line: index, category: item.category });
    uses.set(name, list);
  });
  return [...uses.entries()].map(([name, used]) => buildCandidate(name, details.get(name), used, context.places));
}

export type PlaceContent = {
  tripId: string;
  entityId: string;
  revisionId: string;
  schemaVersion: 2;
  sourceRefs: [];
  kind: 'place';
  payload: {
    regionIds: string[];
    name: string;
    aliases: string[];
    placeKind: PlaceKindCode;
    summary: string;
    dontMiss: string[];
    assetRefs: [];
    wikiRef?: string;
  };
};

/** 새 장소 콘텐츠 하나. 지역 이름이 맞으면 연결하고, 아니면 설명 끝에 표시로 남긴다. */
export function buildPlaceContent(
  tripId: string,
  candidate: PlaceCandidate,
  regions: readonly CatalogRegion[],
): PlaceContent {
  const regionName = candidate.region.trim();
  const region = regionName === '' ? undefined : regions.find((item) => item.name.trim() === regionName);
  return {
    tripId,
    entityId: crypto.randomUUID(),
    revisionId: crypto.randomUUID(),
    schemaVersion: 2,
    sourceRefs: [],
    kind: 'place',
    payload: {
      regionIds: region ? [region.entityId] : [],
      name: candidate.name,
      aliases: [],
      placeKind: candidate.kind,
      summary: composePlaceSummary({
        description: candidate.description,
        regionText: region ? '' : regionName,
        hours: candidate.hours,
      }),
      dontMiss: [],
      assetRefs: [],
      ...(candidate.link === '' ? {} : { wikiRef: candidate.link }),
    },
  };
}

/** 만들 장소를 한 번에 최대 20개씩 나눈다. */
export function chunkPlaces<T>(items: readonly T[]): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += PLACE_BATCH_SIZE) {
    chunks.push(items.slice(index, index + PLACE_BATCH_SIZE));
  }
  return chunks;
}

export type LinkPlan = {
  operations: UpdateOperation[];
  /** 연결되는 활동. 미리보기에 보인다. */
  linked: { date: string; title: string; place: string }[];
};

/**
 * 메모 앞 `[장소: 이름]`이 `placeIds`에 있는 이름이면 그 활동을 그 장소에 연결하고 메모에서 표시를 뺀다.
 * 계획의 다른 부분은 건드리지 않는다. 연산이 없으면 `ChangePlan`을 부르지 않는다.
 */
export function buildLinkPlan(plan: PlanVersion, placeIds: ReadonlyMap<string, string>): LinkPlan {
  const dayDate = new Map(plan.days.map((day) => [day.dayId, day.date]));
  const operations: UpdateOperation[] = [];
  const linked: LinkPlan['linked'] = [];
  for (const item of plan.items) {
    const marked = PLACE_MARK.exec(item.summary.trim());
    const placeId = marked ? placeIds.get(marked[1].trim()) : undefined;
    if (!marked || placeId === undefined) {
      continue;
    }
    const next: PlanItem = structuredClone(item);
    next.summary = (marked[2] ?? '').trim();
    next.placeLinks = [{ placeId, relation: 'visit' }, ...item.placeLinks.filter((link) => link.placeId !== placeId)];
    operations.push({ type: 'upsert-item', item: next });
    linked.push({ date: dayDate.get(item.dayId) ?? '', title: item.title, place: marked[1].trim() });
  }
  return { operations, linked };
}
