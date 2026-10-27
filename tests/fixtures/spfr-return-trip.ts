import { canonicalJson, digestBytes, sourceExtractSchema } from '../../src/contracts/v2';
import { spfrPilotFixture } from './spfr-pilot';

/**
 * Entirely fictional four-day source for date-meaning regressions.
 *
 *   day-28 2033-05-01  stay "fiction" (checkin 05-01)
 *   day-29 2033-05-02  stay "fiction"
 *   day-30 2033-05-03  move day: leaves "fiction" (checkout) and sleeps in "other" (checkin)
 *   day-31 2033-05-04  last day: "other" checks out, no stay of its own
 *
 * No SP-FR prose, reservation or photograph is embedded.
 */
export type ReturnDayRegions = 'unknown' | 'explicit';

export const returnTripDays = [28, 29, 30, 31];

const mapSettings = { zoom: 13, center: [1, 2], routeCache: null };

function dayCard(day: number, date: string, city: string, title: string, stops: Record<string, unknown>[]) {
  return {
    schemaVersion: '1.0',
    day,
    date,
    city,
    title,
    sourceStatus: 'fixture',
    prototypeType: null,
    dayType: 'walk',
    startTime: '09:00',
    endTime: null,
    totalDuration: '미상',
    totalDistance: '미상',
    fatigue: null,
    hotel: null,
    stops,
    legs: [],
    transport: [],
    food: [],
    highlights: [],
    backup: '가상 대안',
    map: mapSettings,
    needsReview: [],
    sourceRefs: [],
  };
}

function stop(id: string, order: number, name: string, extra: Record<string, unknown>) {
  return {
    id,
    order,
    start: null,
    end: null,
    name,
    category: 'walk',
    summary: `${name} 가상 설명`,
    menu: '',
    reservation: '',
    executionStatuses: [],
    executionNote: '',
    optional: false,
    ...extra,
  };
}

const otherSpotMarkdown =
  '---\nslug: other-spot\nname: "가상 다른 장소"\nregion: other\nkind: spot\nsummary: "가상 소개"\n---\n\n## 왜 가는가\n가상 다른 지역 본문\n';

export async function spfrReturnTripFixture(returnDay: ReturnDayRegions) {
  const fixture = await spfrPilotFixture();
  const extract = structuredClone(fixture.extract);
  const rawOf = (path: string) => extract.entries.find((entry) => entry.sourceKey === path)!;
  type SourceValue = (typeof extract.entries)[number]['rawValue'];
  // Round-trip through JSON so the value is plain JSON exactly as an extractor would emit it.
  const plainJson = (value: unknown): SourceValue => JSON.parse(JSON.stringify(value));
  const addJson = (path: string, rawValue: unknown) =>
    extract.entries.push({
      sourceKey: path,
      locator: path,
      sourceKind: 'json',
      rawValue: plainJson(rawValue),
      status: 'extracted',
    });

  rawOf('source/CURRENT/10_Core/itinerary.json').rawValue = {
    schemaVersion: '1',
    trip: { start: '2033-05-01', end: '2033-05-04', days: 4, nights: 3, inflightNights: 0 },
    stays: [
      { key: 'fiction', base: '가상 숙소', checkin: '2033-05-01', checkout: '2033-05-03', nights: 2 },
      { key: 'other', base: '가상 다른 숙소', checkin: '2033-05-03', checkout: '2033-05-04', nights: 1 },
    ],
  };
  addJson(
    'data/daily-cards/day-29.json',
    dayCard(29, '2033-05-02', '가상 지역', '가상 둘째 날', [
      stop('stroll', 0, '가상 산책', { start: '10:00', lat: 1, lng: 2, place_ref: 'fiction-place' }),
    ]),
  );
  const moveDay = dayCard(30, '2033-05-03', '가상 지역 → 다른 지역', '가상 이동일', [
    stop('depart', 0, '가상 출발', { start: '09:00', end: '10:00', lat: 1, lng: 2, place_ref: 'fiction-place' }),
    stop('arrive', 1, '가상 도착', { start: '12:30', lat: 3, lng: 4, place_ref: 'other-spot' }),
  ]);
  moveDay.dayType = 'transfer';
  moveDay.legs = [
    { from: 'depart', to: 'arrive', mode: 'train', duration: '약 2시간', distance: '미상', line: '가상 노선' },
  ] as never[];
  addJson('data/daily-cards/day-30.json', moveDay);
  const lastDayStops =
    returnDay === 'explicit'
      ? [
          stop('airport', 0, '가상 공항', { start: '08:00', category: 'transit' }),
          stop('gift', 1, '가상 선물 가게', { start: '11:00', lat: 3, lng: 4, place_ref: 'other-spot' }),
        ]
      : [
          stop('airport', 0, '가상 공항', { start: '08:00', category: 'transit' }),
          stop('gift', 1, '가상 선물 가게', { start: '11:00' }),
        ];
  const lastDay = dayCard(31, '2033-05-04', '가상 귀국', '가상 귀국일', lastDayStops);
  lastDay.dayType = 'return';
  addJson('data/daily-cards/day-31.json', lastDay);
  extract.entries.push({
    sourceKey: 'source/CURRENT/30_Places/other-spot.md',
    locator: 'source/CURRENT/30_Places/other-spot.md',
    sourceKind: 'markdown',
    rawValue: otherSpotMarkdown,
    status: 'extracted',
  });

  // The extract manifest must describe the edited entries exactly.
  const manifest = await Promise.all(
    extract.entries.map(async (entry) => {
      const encoded = new TextEncoder().encode(canonicalJson(entry.rawValue));
      return { path: entry.sourceKey, byteLength: encoded.length, sha256: await digestBytes(encoded) };
    }),
  );
  return {
    extract: sourceExtractSchema.parse({ ...extract, manifest }),
    options: { ...fixture.options, days: returnTripDays },
    pilotOptions: fixture.options,
  };
}
