import { describe, expect, it } from 'vitest';
import type { ContentRevision, PlanVersion } from '../src/contracts/v2/index';
import { guideDisplayTitle } from '../src/content/display-names';
import { prepSections, regionTravelOrder } from '../src/content/prep-groups';
import { extractHeadings, isSourceSection, readingSections, sourceSections } from '../src/content/guide-view';
import { activityPhoto, mentionOf, photoNature, planDayPhotos } from '../src/content/day-photos';

/** C-15: 파리 여행 읽기 화면 표시 규칙. 가상 장소·가이드만 사용한다. */

type Guide = Extract<ContentRevision, { kind: 'guide' }>;
type Region = Extract<ContentRevision, { kind: 'region' }>;
type Place = Extract<ContentRevision, { kind: 'place' }>;
type Day = PlanVersion['days'][number];
type Item = PlanVersion['items'][number];

const region = (entityId: string, name: string) => ({ entityId, payload: { name } }) as unknown as Region;
const guide = (
  entityId: string,
  title: string,
  documentKind: string,
  owner: { targetKind: string; entityId: string },
  source = '',
) =>
  ({
    entityId,
    sourceRefs: source ? [{ sourcePath: source }] : [],
    payload: { title, documentKind, ownerRef: { tripId: 't', ...owner }, sections: [] },
  }) as unknown as Guide;
const day = (date: string, regionIds: string[], extra: Partial<Day> = {}) =>
  ({
    dayId: date,
    ordinal: 1,
    date,
    cityText: '',
    title: '',
    regionIds,
    highlights: [],
    assetRefs: [],
    ...extra,
  }) as unknown as Day;

describe('준비·회화 묶음', () => {
  const regions = [region('paris', 'Paris'), region('aix', 'Aix-en-Provence'), region('nice', 'Nice · Côte d’Azur')];
  const days = [day('2026-09-01', ['nice']), day('2026-09-10', ['aix']), day('2026-09-24', ['paris'])];
  const trip = { targetKind: 'trip', entityId: 't' };
  const guides = [
    guide('transit-paris', '교통권과 이용 안내', 'transit', { targetKind: 'region', entityId: 'paris' }),
    guide('essentials-paris', '생활·도착·귀가 안내', 'region-essentials', { targetKind: 'region', entityId: 'paris' }),
    guide('rg-paris', 'paris · 지역 가이드', 'region-guide', { targetKind: 'region', entityId: 'paris' }),
    guide(
      'cgm-paris',
      'Commercial Guide Module',
      'preparation',
      trip,
      'source/CURRENT/20_Regional_Chapters/11_Paris_Long_Stay_v2.0.md',
    ),
    guide('rg-aix', 'aix · 지역 가이드', 'region-guide', { targetKind: 'region', entityId: 'aix' }),
    guide('rg-nice', 'nice · 지역 가이드', 'region-guide', { targetKind: 'region', entityId: 'nice' }),
    guide('fr', '프랑스어 발음·표지·메뉴', 'language-guide', trip),
    guide('contacts', '원천 공통 안내 · 긴급 연락처', 'preparation', trip),
    guide('booking', '원천 공통 안내 · 예약 원칙', 'preparation', trip),
    guide('itinerary', '전체 일정', 'preparation', trip),
    guide('howto', '01. 이 가이드북을 사용하는 법', 'preparation', trip),
    guide('highlights', '02. 전체 여행 경험 하이라이트', 'preparation', trip),
  ];
  const sections = prepSections(guides, regions, days);

  it('여행 전체 절이 맨 위, 지역 절은 일정의 첫 등장일 순서다', () => {
    expect(sections.map((section) => section.title)).toEqual([
      '여행 전체',
      'Nice · Côte d’Azur',
      'Aix-en-Provence',
      'Paris',
    ]);
  });
  it('여행 전체 절의 순서는 이용법 → 하이라이트 → 일정 → 예약 → 긴급 연락처 → 회화이고 원천 접두가 없다', () => {
    expect(sections[0].entries.map((entry) => entry.label)).toEqual([
      '01. 이 가이드북을 사용하는 법',
      '02. 전체 여행 경험 하이라이트',
      '전체 일정',
      '예약 원칙',
      '긴급 연락처',
      '프랑스어 발음·표지·메뉴',
    ]);
  });
  it('지역 절 안은 지역 가이드 → 상세 안내 → 생활 → 교통권이고 지역 접두가 없다', () => {
    const paris = sections.find((section) => section.regionId === 'paris')!;
    expect(paris.entries.map((entry) => entry.label)).toEqual([
      '지역 가이드',
      '지역 상세 안내',
      '생활·도착·귀가 안내',
      '교통권과 이용 안내',
    ]);
  });
  it('일정에 없는 지역은 맨 뒤로 가고 같은 지역은 한 이름으로 통일된다', () => {
    expect(regionTravelOrder(regions, [day('2026-09-01', ['paris'])]).map((r) => r.entityId)[0]).toBe('paris');
    expect(guideDisplayTitle('aix · 지역 가이드', regions[1])).toBe('Aix-en-Provence · 지역 가이드');
    expect(guideDisplayTitle('Commercial Guide Module')).toBe('지역 상세 안내');
  });
});

describe('가이드 읽기 모델', () => {
  it('원천 속성 섹션은 읽기 본문이 아니다', () => {
    const g = {
      payload: {
        sections: [
          { key: 'source-frontmatter', title: '원천 지역 속성', order: 1, bodyMd: 'slug: aix' },
          { key: 'body', title: '지역 본문', order: 0, bodyMd: '## 가' },
        ],
      },
    } as unknown as Guide;
    expect(readingSections(g).map((s) => s.key)).toEqual(['body']);
    expect(sourceSections(g).map((s) => s.key)).toEqual(['source-frontmatter']);
    expect(isSourceSection(g.payload.sections[0])).toBe(true);
  });
  it('목차는 화면과 같이 인용·목록 안 머리말과 밑줄식 머리말도 세고 몇 번을 해석해도 같다', () => {
    const body = '> ## 인용 머리\n\n밑줄 머리\n---\n\n- ### 목록 머리\n\n## `코드` 머리';
    const expected = [
      { index: 0, level: 2, text: '인용 머리' },
      { index: 1, level: 2, text: '밑줄 머리' },
      { index: 2, level: 3, text: '목록 머리' },
      { index: 3, level: 2, text: '코드 머리' },
    ];
    expect(extractHeadings(body)).toEqual(expected);
    expect(extractHeadings(body)).toEqual(expected);
  });
  it('목차는 코드 블록 밖의 ##·### 머리말만 순서대로 뽑는다', () => {
    const body = '# 제목\n## 첫째\n본문\n```text\n## 코드\n```\n### 둘째 *강조*\n#### 더 깊음\n## 셋째 ##';
    expect(extractHeadings(body)).toEqual([
      { index: 0, level: 2, text: '첫째' },
      { index: 1, level: 3, text: '둘째 강조' },
      { index: 2, level: 2, text: '셋째' },
    ]);
  });
});

describe('날짜 대표 사진', () => {
  const asset = (id: string, caption: string) => ({ assetId: id, role: 'hero' as const, caption });
  const place = (id: string, name: string, extra: Record<string, unknown> = {}): Place =>
    ({
      entityId: id,
      payload: {
        name,
        aliases: [],
        placeKind: 'spot',
        assetRefs: [asset(`asset-${id}`, `${name} · 저작자`)],
        ...extra,
      },
    }) as unknown as Place;
  const item = (id: string, order: number, placeId: string, category: string): Item =>
    ({
      activityId: id,
      dayId: 'd1',
      order,
      title: id,
      category,
      placeLinks: [{ placeId, relation: 'visit' }],
    }) as unknown as Item;

  it('출발역·빵집보다 일정 문구에 나오는 관광 장소를 대표로 고른다', () => {
    const places = [
      place('station', 'Nice-Ville', { placeKind: 'transport' }),
      place('bakery', 'Boulangerie Pichard'),
      place('rocher', 'Le Rocher'),
    ];
    const d = day('2026-09-07', ['nice'], {
      dayId: 'd1',
      title: '모나코 당일치기',
      highlights: ['Le Rocher & Monaco-Ville'],
      assetRefs: places.map((p) => asset(`asset-${p.entityId}`, `${p.payload.name} · 저작자`)),
    });
    const items = [
      item('a', 1, 'station', 'transport'),
      item('b', 2, 'bakery', 'food'),
      item('c', 3, 'rocher', 'sight'),
    ];
    const result = planDayPhotos(d, items, places);
    expect(result.cover?.label).toBe('Le Rocher');
    expect(result.photos.map((p) => p.label)).toEqual(['Le Rocher', 'Nice-Ville', 'Boulangerie Pichard']);
    expect(d.assetRefs.map((a) => a.assetId)).toEqual(['asset-station', 'asset-bakery', 'asset-rocher']);
  });
  it('일정 문구에 이름이 없으면 이동·식사·숙소보다 관광 장소가 먼저, 그다음 원래 순서다', () => {
    const places = [place('hotel', 'Hôtel Test'), place('cafe', 'Café du Commerce'), place('museum', 'Musée Test')];
    const d = day('2026-10-09', ['paris'], {
      dayId: 'd1',
      assetRefs: places.map((p) => asset(`asset-${p.entityId}`, `${p.payload.name} · x`)),
    });
    const items = [item('a', 1, 'hotel', 'hotel'), item('b', 2, 'cafe', 'food'), item('c', 3, 'museum', 'culture')];
    expect(planDayPhotos(d, items, places).cover?.label).toBe('Musée Test');
    const onlyRoutine = planDayPhotos(
      { ...d, assetRefs: d.assetRefs.slice(0, 2) },
      items.slice(0, 2),
      places.slice(0, 2),
    );
    expect(onlyRoutine.cover?.label).toBe('Hôtel Test');
  });
  it('이름의 고유한 낱말만 나와도 다른 관광 장소보다 먼저 고르고 흔한 낱말은 무시한다', () => {
    const places = [place('market', 'Les Halles Test'), place('palace', 'Palais des Papes'), place('m', 'Musée Autre')];
    const d = day('2026-09-19', ['avignon'], {
      dayId: 'd1',
      cityText: 'Test',
      title: '교황도시 (Test 시내)',
      highlights: ['Palais 09:45 입장', 'Musée 밤 개장'],
      assetRefs: places.map((p) => asset(`asset-${p.entityId}`, `${p.payload.name} · x`)),
    });
    const items = [item('a', 1, 'market', 'shopping'), item('b', 2, 'palace', 'culture'), item('c', 3, 'm', 'culture')];
    expect(planDayPhotos(d, items, places).cover?.label).toBe('Palais des Papes');
    expect(mentionOf(d, ['Musée Autre'])).toBe('none');
    expect(mentionOf(d, ['Palais des Papes'])).toBe('partial');
  });
  it('사진이 없는 날은 사진 없음', () => {
    expect(planDayPhotos(day('2026-08-29', ['barcelona'], { dayId: 'd1' }), [], [])).toEqual({
      photos: [],
      reason: '사진 없음',
    });
  });
  it('한국어 역 이름은 낱말 끝의 역만 이동으로 본다', () => {
    for (const name of ['삿포로역', '오타루역 앞', 'JR 삿포로역 남쪽 출구']) {
      expect(photoNature(place('p', name), undefined, name)).toBe('transit');
    }
    expect(photoNature(place('p', '역사 박물관'), undefined, '역사 박물관')).toBe('sight');
  });
  it('장소 종류 판정과 활동 사진 연결', () => {
    expect(photoNature(place('p', 'Gare de Lyon'), undefined, 'Gare de Lyon')).toBe('transit');
    expect(photoNature(place('p', 'Boulangerie X'), undefined, 'Boulangerie X')).toBe('meal');
    expect(photoNature(place('p', 'Hotel Y'), undefined, 'Hotel Y')).toBe('lodging');
    expect(photoNature(place('p', 'Louvre'), undefined, 'Louvre')).toBe('sight');
    const museum = place('museum', 'Musée Test');
    expect(activityPhoto(item('c', 3, 'museum', 'culture'), [museum], [])?.assetId).toBe('asset-museum');
    expect(activityPhoto(item('x', 1, 'none', 'sight'), [museum], [])).toBeUndefined();
  });
});
