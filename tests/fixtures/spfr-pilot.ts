import { canonicalJson, digestBytes, sourceExtractSchema } from '../../src/contracts/v2';
import { workbookPath } from '../../src/transfer/spfr-workbook';

/** Entirely fictional source shapes. No source travel prose, reservation or photo is embedded. */
export async function spfrPilotFixture() {
  const values = new Map<string, unknown>();
  const put = (path: string, value: unknown) => values.set(path, value);
  put('source/CURRENT/10_Core/itinerary.json', {
    schemaVersion: '1',
    trip: { start: '2033-05-01', end: '2033-05-05', days: 5, nights: 4, inflightNights: 0 },
    stays: [{ key: 'fiction', base: '가상 숙소', checkin: '2033-05-01', checkout: '2033-05-04', nights: 3 }],
  });
  put('source/CURRENT/10_Core/regions.json', {
    schemaVersion: '1',
    note: '가상 기준',
    sourceOfTruth: 'fixture',
    regions: [
      { slug: 'fiction', name: '가상 지역', country: 'FR' },
      { slug: 'other', name: '다른 지역' },
    ],
  });
  put('data/daily-cards/day-28.json', {
    schemaVersion: '1.0',
    day: 28,
    date: '2033-05-01',
    city: '가상 지역',
    title: '가상 하루',
    sourceStatus: 'fixture',
    prototypeType: null,
    dayType: 'walk',
    startTime: '09:00',
    endTime: null,
    totalDuration: '반나절',
    totalDistance: '미상',
    fatigue: 1,
    hotel: { name: '가상 숙소', lat: 1, lng: 2, status: 'fixture', address: '실제 주소 아님' },
    stops: [
      {
        id: 'walk',
        order: 0,
        start: '09:00',
        end: '10:00',
        name: '가상 장소',
        category: 'walk',
        lat: 1,
        lng: 2,
        summary: '가상 산책',
        menu: '가상 메뉴',
        reservation: '미확정',
        executionStatuses: [{ type: 'source', label: '확인 필요', detail: '가상 상태' }],
        executionNote: '가상 보충',
        officialUrl: 'https://example.com/fiction',
        optional: false,
        place_ref: 'fiction-place',
      },
    ],
    legs: [],
    transport: ['도보'],
    food: ['가상 식사'],
    highlights: ['가상 핵심'],
    backup: '가상 대안',
    map: { zoom: 13, center: [1, 2], routeCache: null },
    needsReview: ['개방 확인'],
    sourceRefs: ['fiction-source'],
  });
  put('data/place-facts.json', {
    version: 1,
    places: {
      'fiction-place': { facts: { hours: { value: '미상', confidence: 'unknown' } } },
      'other-place': { facts: { hours: { value: '다른 날짜' } } },
    },
  });
  put('data/map-queries.json', {
    schemaVersion: 1,
    verifiedAt: '2033-01-01',
    note: '가상 지도',
    places: { 'fiction-place': { query: 'Fictional place', verdict: 'source-only' } },
    hotels: {},
    stops: {},
    routes: {},
    nonMapStops: [],
  });
  put('data/region-essentials.json', {
    schemaVersion: 1,
    regions: {
      fiction: {
        staySummary: '가상 숙박',
        lifeEssentials: ['가상 상점'],
        arrivalStrategy: '가상 도착',
        departureStrategy: '가상 출발',
        lateReturnRule: '가상 귀가',
        sourceRefs: ['fixture'],
      },
    },
  });
  put('data/transit-facts.json', {
    schemaVersion: 1,
    regions: {
      fiction: {
        recommendation: { title: '가상 교통', summary: '가상 추천' },
        products: [{ name: '가상 권종', price: '미상', shared: false, accessNote: '확인 필요', fit: '가상 용도' }],
        howToUse: ['가상 사용'],
        exceptions: [],
        itineraryUses: [
          { day: 28, label: '표본' },
          { day: 29, label: '표본 밖' },
        ],
        sources: [],
      },
    },
  });
  put('data/transit-resources.json', { schemaVersion: 1, regions: { fiction: [] } });
  put('data/tourist-maps.json', { schemaVersion: 1, regions: { fiction: [] } });
  put('data/travel-french-phrases.json', {
    schema_version: 1,
    language: 'fr-FR',
    note_ko: '가상 회화',
    count: 1,
    phrases: [
      {
        id: 'fiction-phrase',
        category: 'greeting',
        priority: 'P0',
        fr: 'Bonjour',
        ko: '안녕하세요',
        pronunciation_hint: '봉주르',
        usage_note: '가상 인사',
        tags: ['fixture'],
        audio_text: 'Bonjour',
      },
    ],
  });
  put('data/travel-french-guide.json', {
    schema_version: 1,
    language: 'fr-FR',
    pronunciation_rules: [
      {
        id: 'rule',
        title: '가상 발음',
        rules: [{ pattern: 'ou', sound: '우', example: '가상 예', note: '가상 주의' }],
      },
    ],
    signs_and_menu: [
      { category: 'sign', title: '가상 표지', words: [{ fr: 'Sortie', ko: '출구', pronunciation: '소르티' }] },
    ],
  });
  put('data/field-notes.json', {
    version: 1,
    note: '가상 현장 상태',
    notes: [
      {
        id: 'other-note',
        author: 'fixture',
        ts: '2033-04-30T09:00:00Z',
        entity: { kind: 'day', key: 'day-27' },
        text: '다른 날 메모',
      },
    ],
    visited: {},
    checkedActions: {},
  });
  put('data/booking-overrides.json', { version: 1, note: '가상 예약 수정', overrides: {} });
  const bytes = new TextEncoder().encode('synthetic image bytes, deliberately not a real photo');
  const sha256 = await digestBytes(bytes);
  const sourcePath = 'source/ASSETS/fiction.webp';
  put('data/images/image-manifest.json', {
    schemaVersion: 1,
    generatedAt: '2033-01-01',
    regions: ['fiction'],
    processedAt: '2033-01-01',
    images: [
      {
        imageId: 'fiction-image',
        placeId: 'fiction-place',
        titleKo: '가상 이미지',
        title: 'Fiction',
        sourcePage: 'https://example.com/image',
        creator: '가상 저작자',
        license: 'fixture-only',
        changes: '가상 변형',
        usage: ['daily/day-28.html'],
        region: 'fiction',
        regionHero: true,
        altKo: '가상 이미지',
        captionKo: '실제 사진 아님',
        variants: { content: [{ path: sourcePath, bytes: bytes.length, sha256, width: 1 }] },
      },
    ],
  });
  put(
    'source/CURRENT/30_Places/fiction-place.md',
    '---\nslug: fiction-place\nname: "가상 장소"\nregion: fiction\nkind: spot\nsummary: "가상 소개"\n---\n\n## 왜 가는가\n가상 본문\n\n## 더 깊이\n가상 역사\n\n## 실용\n가상 실용\n',
  );
  put(
    'source/CURRENT/20_Regions/fiction.md',
    '---\nslug: fiction\nsource: fixture\n---\n\n## 가상 지역\n가상 지역 본문\n',
  );
  put(
    'source/ASSETS/91_Place_Registry_v1.0.md',
    '| `fiction-place` | 가상 장소 | spot | 선택 | 가상 핀 | 가상 본문 | 가상 헤딩 | — |\n',
  );
  put('build/render.py:PARIS_MUSEUM_BOOKINGS', [
    {
      id: 'fiction|2033-05-01',
      day: 28,
      slug: 'fiction-place',
      name: '가상 코드 예약',
      schedule: '오전',
      canonical_status: 'unknown',
      stage: '가상 단계',
      when: '확인 시',
      action_date: '확인 필요',
      pmp: '가상 패스',
      plan_b: '가상 대안',
      note: '가상 예약',
      official_url: 'https://example.com/booking',
    },
  ]);
  const cell = (sheet: string, address: string, value: unknown) =>
    put(`${workbookPath}:${sheet}!${address}`, { value, cellType: 's', cachedValue: value });
  const names = [
    'Lists',
    'Master Itinerary',
    'Reservations',
    'Transport',
    'Accommodation',
    'Assets',
    'Publication QA',
    'Dashboard',
    'Detailed Maps',
    'Photo Rights',
    'Field Shots',
    'Phase8 Lock Status',
  ];
  for (const name of names) {
    cell(name, name === 'Lists' ? 'A1' : 'A3', '가상 열');
  }
  cell('Master Itinerary', 'A4', { sourceType: 'datetime', isoValue: '2033-05-01T00:00:00' });
  cell('Master Itinerary', 'M4', '가상 운동 계획');
  cell('Master Itinerary', 'A5', { sourceType: 'datetime', isoValue: '2033-05-02T00:00:00' });
  cell('Master Itinerary', 'M5', '다른 날짜 계획');
  for (const [column, value] of Object.entries({
    A: 'R001',
    B: 'museum',
    C: 'Fiction',
    D: '가상 표 예약',
    E: { sourceType: 'datetime', isoValue: '2033-05-01T00:00:00' },
    F: '10:00',
    H: '가상 미확정',
    O: 'SYNTHETIC-NUMBER',
    Q: '실제 주소 아님',
    R: 'https://example.com/ticket',
  })) {
    cell('Reservations', `${column}4`, value);
  }
  cell('Assets', 'C4', '전체');
  cell('Assets', 'D4', '가상 전체 자산 기준');
  cell('Publication QA', 'B4', '11 Fiction Long Stay');
  cell('Publication QA', 'N4', '가상 지역 검수');
  const entries = [...values].map(([sourceKey, rawValue]) => ({
    sourceKey,
    locator: sourceKey,
    sourceKind: sourceKey.includes('.xlsx:')
      ? 'xlsx'
      : sourceKey.endsWith('.md')
        ? 'markdown'
        : sourceKey.includes('.py:')
          ? 'python'
          : 'json',
    rawValue,
    status: 'extracted',
  }));
  const manifest = await Promise.all(
    [...values].map(async ([path, value]) => {
      const encoded = new TextEncoder().encode(canonicalJson(value));
      return { path, byteLength: encoded.length, sha256: await digestBytes(encoded) };
    }),
  );
  return {
    extract: sourceExtractSchema.parse({
      format: 'travel-app-source-extract',
      version: 1,
      sourceRepository: 'fiction/source',
      sourceCommit: 'a'.repeat(40),
      adapter: 'fixture',
      extractorVersion: '1',
      manifest,
      entries,
      unresolved: [],
    }),
    options: {
      days: [28],
      tripId: 'fiction-pilot',
      createdAt: '2033-05-10T00:00:00Z',
      media: [{ sourcePath, sha256, byteLength: bytes.length, bytes }],
    },
  };
}
