import type { ContentRevision, PlanVersion } from '../contracts/v2';

/**
 * 날짜 사진 표시 규칙(C-15). 저장된 `assetRefs` 순서는 바꾸지 않고, 화면에 보일 대표 사진과 사진 목록만 정한다.
 */

type Place = Extract<ContentRevision, { kind: 'place' }>;
type Day = PlanVersion['days'][number];
type Item = PlanVersion['items'][number];
type AssetRef = Day['assetRefs'][number];

export type PhotoNature = 'sight' | 'transit' | 'meal' | 'lodging';

export type DayPhoto = {
  asset: AssetRef;
  /** 사진이 속한 장소 이름. 장소를 찾지 못하면 캡션 앞부분을 쓴다. */
  label: string;
  place?: Place;
  /** 이 장소를 방문하는 그날의 첫 활동. 활동 카드와 사진을 잇는 근거다. */
  activity?: Item;
  nature: PhotoNature;
  /** 그날 highlights·제목·도시 문구에 장소 이름(전체 또는 고유한 일부)이 나오는가. */
  mentioned: boolean;
  /** 낮을수록 대표로 먼저 고른다. */
  tier: number;
  order: number;
};

export type DayPhotoPlan = {
  cover?: DayPhoto;
  photos: DayPhoto[];
  /** 대표를 고른 이유(결과 문서·대조표용). */
  reason: string;
};

const TRANSIT_NAME = /역\b|공항|렌터카|터미널|\bgare\b|\bstation\b|airport|-ville\b|\bsants\b|\bTGV\b/i;
const MEAL_NAME = /boulangerie|bakery|café|cafe|restaurant|bistro|brasserie|빵집|카페|식당|레스토랑|\bbar\b/i;
const LODGING_NAME = /\bhotel\b|\bhôtel\b|airbnb|숙소|\bgîte\b|\bgite\b|farmhouse/i;

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** 캡션은 `장소 · 저작자 · 라이선스` 모양이므로 앞부분이 장소 이름이다. */
function captionName(caption: string | undefined): string {
  return (caption ?? '').split(' · ')[0].trim();
}

/** 장소 종류는 연결 활동 분류, 장소 종류·식사 필드, 이름 순으로 판정한다. */
export function photoNature(place: Place | undefined, activity: Item | undefined, label: string): PhotoNature {
  const kind = place?.payload.placeKind ?? '';
  const name = place?.payload.name ?? label;
  if (activity?.category === 'hotel' || /hotel|lodging|stay/i.test(kind) || LODGING_NAME.test(name)) {
    return 'lodging';
  }
  if (activity?.category === 'transport' || kind === 'transport' || TRANSIT_NAME.test(name)) {
    return 'transit';
  }
  if (
    activity?.category === 'food' ||
    place?.payload.foodKind ||
    place?.payload.mealRole ||
    /food|restaurant|cafe/i.test(kind) ||
    MEAL_NAME.test(name)
  ) {
    return 'meal';
  }
  return 'sight';
}

/** 이름의 흔한 낱말은 일부 일치 판정에 쓰지 않는다. */
const GENERIC_TOKENS = new Set([
  'musee',
  'museum',
  'place',
  'marche',
  'saint',
  'sainte',
  'parc',
  'pont',
  'vieux',
  'port',
  'paris',
  'chateau',
  'basilique',
  'cathedrale',
  'jardin',
  'palau',
  'plage',
  'route',
]);

type Mention = 'full' | 'partial' | 'none';

/**
 * 그날 제목·도시·핵심 문구에 장소 이름이 나오는지 본다. 이름 전체가 나오면 `full`,
 * 이름의 고유한 낱말(4자 이상, 흔한 낱말·도시 이름 제외)만 나오면 `partial`이다.
 */
export function mentionOf(day: Day, names: string[]): Mention {
  const haystack = fold([day.title, day.cityText, ...day.highlights].join(' \n '));
  const needles = names.map((name) => fold(name).trim()).filter((needle) => needle.length >= 2);
  if (needles.some((needle) => haystack.includes(needle))) {
    return 'full';
  }
  const words = new Set(haystack.split(/[^\p{L}\p{N}]+/u));
  // 도시 이름은 그날 장소 대부분의 이름에 들어 있어 구분하지 못하므로 일부 일치에서 뺀다.
  const cityWords = new Set(fold(day.cityText).split(/[^\p{L}\p{N}]+/u));
  const tokens = needles.flatMap((needle) => needle.split(/[^\p{L}\p{N}]+/u));
  const distinctive = (token: string) => token.length >= 4 && !GENERIC_TOKENS.has(token) && !cityWords.has(token);
  return tokens.some((token) => distinctive(token) && words.has(token)) ? 'partial' : 'none';
}

/**
 * 순위: ① 이름 전체가 나오는 관광 장소 ② 이름 일부가 나오는 관광 장소 ③ 그 밖의 관광 장소
 * ④ 이름 전체가 나오는 이동·식사·숙소 ⑤ 나머지. 같은 순위 안에서는 저장된 순서를 따른다.
 */
function tierOf(nature: PhotoNature, mention: Mention): number {
  if (nature === 'sight') {
    return { full: 0, partial: 1, none: 2 }[mention];
  }
  return mention === 'full' ? 3 : 4;
}

const NATURE_REASON: Record<PhotoNature, string> = {
  sight: '관광 장소',
  transit: '이동',
  meal: '식사',
  lodging: '숙소',
};

export function planDayPhotos(day: Day, items: Item[], places: Place[]): DayPhotoPlan {
  if (!day.assetRefs.length) {
    return { photos: [], reason: '사진 없음' };
  }
  const dayItems = items.filter((item) => item.dayId === day.dayId).toSorted((a, b) => a.order - b.order);
  const photos = day.assetRefs.map((asset, order): DayPhoto => {
    const linkedPlaceIds = new Set(dayItems.flatMap((item) => item.placeLinks.map((link) => link.placeId)));
    const place =
      places.find(
        (candidate) =>
          linkedPlaceIds.has(candidate.entityId) &&
          candidate.payload.assetRefs.some((a) => a.assetId === asset.assetId),
      ) ?? places.find((candidate) => candidate.payload.assetRefs.some((a) => a.assetId === asset.assetId));
    const activity = place
      ? (dayItems.find((item) =>
          item.placeLinks.some((link) => link.placeId === place.entityId && link.relation === 'visit'),
        ) ?? dayItems.find((item) => item.placeLinks.some((link) => link.placeId === place.entityId)))
      : undefined;
    const label = place?.payload.name ?? captionName(asset.caption);
    const nature = photoNature(place, activity, label);
    const mention = mentionOf(day, [label, captionName(asset.caption), ...(place?.payload.aliases ?? [])]);
    return {
      asset,
      label,
      place,
      activity,
      nature,
      mentioned: mention !== 'none',
      tier: tierOf(nature, mention),
      order,
    };
  });
  const ranked = photos.toSorted((a, b) => a.tier - b.tier || a.order - b.order);
  const cover = ranked[0];
  const reason = `${cover.tier <= 1 || cover.tier === 3 ? '일정 문구에 이름이 나오는 ' : ''}${NATURE_REASON[cover.nature]}`;
  return { cover, photos: [cover, ...photos.filter((photo) => photo !== cover)], reason };
}

/** 활동 카드에 붙일 사진: 그 활동의 방문 장소에 속한 사진(날짜 사진 우선, 없으면 장소 대표 사진). */
export function activityPhoto(item: Item, places: Place[], dayPhotos: DayPhoto[]): AssetRef | undefined {
  const visit = item.placeLinks.find((link) => link.relation === 'visit');
  if (!visit) {
    return undefined;
  }
  const fromDay = dayPhotos.find((photo) => photo.place?.entityId === visit.placeId);
  if (fromDay) {
    return fromDay.asset;
  }
  const place = places.find((candidate) => candidate.entityId === visit.placeId);
  return place?.payload.assetRefs.find((asset) => asset.role === 'hero') ?? place?.payload.assetRefs[0];
}
