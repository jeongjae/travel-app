import { z } from 'zod';
import {
  contentRevisionSchema,
  digestBytes,
  sourceExtractSchema,
  validateTripDataset,
  type ContentRevision,
  type RevisionRef,
  type TargetRef,
} from '../contracts/v2/index.ts';
import { normalizeSpfrCandidate } from './spfr-candidate.ts';
import { currentMappings } from './normalize.ts';
import {
  SourceCoverage,
  sourceObject as obj,
  sourceObjects as arr,
  sourceString as str,
  sourceText as text,
  sourceRefFor,
  sourceTable,
  section,
  type Section,
} from './spfr-source.ts';
import { mapSpfrWorkbook, workbookPath } from './spfr-workbook.ts';
import { mapSpfrMedia, type PilotMediaFile } from './spfr-media.ts';
import { mapSpfrFieldState } from './spfr-field-state.ts';
import { splitSpfrGuides } from './spfr-guide-chunks.ts';
import { bindSpfrFacts } from './spfr-fact-bindings.ts';
import { bindSpfrLinks } from './spfr-links.ts';

const cloneJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const escaped = (value: string) => value.replaceAll('~', '~0').replaceAll('/', '~1');

/** Complete scoped adapter. A regional batch is isolated from previously reviewed packages. */
export async function normalizeSpfrPilot(
  raw: unknown,
  options: {
    days: number[];
    tripId: string;
    createdAt: string;
    media: PilotMediaFile[];
    additionalPlaceIds?: string[];
    bodylessPlaceIds?: string[];
    fullSourceScope?: boolean;
  },
) {
  const extract = sourceExtractSchema.parse(raw);
  const base = await normalizeSpfrCandidate(extract, options);
  const dataset = structuredClone(base.dataset);
  const plan = dataset.plans[0];
  const tripId = dataset.header.tripId;
  const contents = dataset.contents;
  const coverage = new SourceCoverage(extract);
  const blocking = base.report.blocking.filter(
    (reason) =>
      ![
        'XLSX_MAPPING_PENDING',
        'MEDIA_MAPPING_PENDING',
        'REGION_LANGUAGE_FIELD_STATE_MAPPING_PENDING',
        'FULL_FIELD_COVERAGE_PENDING',
      ].includes(reason) && !reason.startsWith('FACT_SOURCE_MISSING:'),
  );
  const warnings: string[] = [];
  const json = (path: string) => {
    const entry = extract.entries.find((entry) => entry.sourceKey === path && entry.status === 'extracted');
    if (!entry) {
      throw new Error(`필수 원천 누락: ${path}`);
    }
    return obj(entry.rawValue);
  };
  const add = (kind: ContentRevision['kind'], entityId: string, payload: unknown, path: string, locator = path) => {
    const content = contentRevisionSchema.parse(
      cloneJson({
        tripId,
        entityId,
        kind,
        revisionId: 'source-1',
        schemaVersion: 2,
        sourceRefs: [sourceRefFor(path, locator)],
        recordedAt: options.createdAt,
        actor: 'import',
        commitSeq: 1,
        payload,
      }),
    );
    if (contents.some((old) => old.kind === kind && old.entityId === entityId)) {
      throw new Error(`중복 이행 ID: ${kind}/${entityId}`);
    }
    contents.push(content);
    return content;
  };
  const ref = (kind: ContentRevision['kind'], entityId: string): RevisionRef => ({
    tripId,
    targetKind: kind,
    entityId,
    revisionId: 'source-1',
  });
  const tripRef: TargetRef = { tripId, targetKind: 'trip', entityId: tripId };
  const guide = (
    id: string,
    title: string,
    sections: Section[],
    path: string,
    ownerRef = tripRef,
    documentKind: 'preparation' | 'region-guide' = 'preparation',
  ) =>
    add(
      'guide',
      id,
      {
        documentKind,
        ownerRef,
        title,
        language: 'ko',
        sections,
        factBindings: [],
        assetRefs: [],
      },
      path,
    );
  const comparison = new Map<string, { id: string; sections: Section[] }>();
  const show = (path: string, prefix: string, value: unknown, title: string, existingGuide?: string) => {
    let group = comparison.get(path);
    if (!group) {
      const id = existingGuide ?? `source-${comparison.size}`;
      group = { id, sections: [] };
      comparison.set(path, group);
    }
    const key = `source-${group.sections.length}`;
    group.sections.push(section(key, title, sourceTable(value), group.sections.length));
    coverage.mark(path, prefix, 'displayed', `guide/${group.id}#${key}`, '보충 정보·원천 대조표에서 값과 항목을 조회');
  };
  const meta = (path: string, key: string) =>
    coverage.mark(
      path,
      `/${escaped(key)}`,
      'metadata',
      path,
      '원천 형식·생성 정보; 이행 보고서의 고정 원천과 함께 보존',
    );
  const defer = (path: string, prefix: string) => {
    if (options.fullSourceScope) {
      let value: unknown = extract.entries.find((entry) => entry.sourceKey === path)!.rawValue;
      for (const key of prefix.split('/').slice(1)) {
        value = Array.isArray(value) ? value[Number(key)] : obj(value)[key.replaceAll('~1', '/').replaceAll('~0', '~')];
      }
      show(path, prefix, value, `통합 원천 보충 · ${prefix || path}`);
      return;
    }
    coverage.mark(
      path,
      prefix,
      'deferred',
      'Phase 2',
      '선택 일자·명시 지역 밖의 원천. 삭제·전체 이행 범위 제외가 아니며 다음 배치에서 재처리',
    );
  };
  const selectedRegions = contents.filter((content) => content.kind === 'region').map((content) => content.entityId);
  const selectedPlaces = contents.filter((content) => content.kind === 'place').map((content) => content.entityId);
  const dates = plan.days.map((day) => day.date);
  const itineraryPath = 'source/CURRENT/10_Core/itinerary.json';
  const itinerary = json(itineraryPath);
  show(itineraryPath, '/trip', itinerary.trip, `전체 여행의 원천 날짜·박수 (이번 배치는 ${options.days.length}일)`);
  const trip = obj(itinerary.trip);
  dataset.header.sourceMetadata = {
    days: z.number().int().parse(trip.days),
    nights: z.number().int().parse(trip.nights),
    inflightNights: z.number().int().parse(trip.inflightNights),
  };
  for (const [index, stay] of arr(itinerary.stays).entries()) {
    if (dates.some((date) => str(stay.checkin) <= date && date < str(stay.checkout))) {
      show(itineraryPath, `/stays/${index}`, stay, '이 구간의 숙박 원천');
      plan.stays.push({
        tripId,
        planVersionId: plan.planVersionId,
        stayId: `source-stay-${index}`,
        regionId: str(stay.key),
        baseText: str(stay.base),
        plannedNights: z.number().int().parse(stay.nights),
        time: {
          start: { precision: 'date', date: str(stay.checkin) },
          end: { precision: 'date', date: str(stay.checkout) },
        },
        locationStatus: 'source-only-unverified',
      });
    } else {
      defer(itineraryPath, `/stays/${index}`);
    }
  }
  for (const key of Object.keys(itinerary).filter((key) => !['trip', 'stays'].includes(key))) {
    if (key !== 'schemaVersion') {
      blocking.push(`ITINERARY_FIELD_UNSUPPORTED:${key}`);
    } else {
      meta(itineraryPath, key);
    }
  }
  const regionsPath = 'source/CURRENT/10_Core/regions.json';
  const regions = json(regionsPath);
  for (const [index, region] of arr(regions.regions).entries()) {
    if (selectedRegions.includes(str(region.slug))) {
      show(regionsPath, `/regions/${index}`, region, '지역 소개·원천 기준');
    } else {
      defer(regionsPath, `/regions/${index}`);
    }
  }
  for (const key of Object.keys(regions).filter((key) => key !== 'regions')) {
    show(regionsPath, `/${escaped(key)}`, regions[key], `지역 자료의 ${key}`);
  }
  for (const day of plan.days) {
    const dayNumber = Number(day.dayId.slice(4));
    const path = `data/daily-cards/day-${String(dayNumber).padStart(2, '0')}.json`;
    const card = json(path);
    const dayGuide = `day-guide-${day.dayId}`;
    for (const [key, value] of Object.entries(card)) {
      // A complete labeled comparison is deliberate: it preserves hotel, map cache, markers and original sourceRefs too.
      show(
        path,
        `/${escaped(key)}`,
        value,
        (
          {
            hotel: '숙소 · 원천 상태',
            map: '지도 중심·경로 보충',
            stops: '활동 세부·원천 상태',
            legs: '이동 세부',
            sourceRefs: '원천 참조',
          } as Record<string, string>
        )[key] ?? key,
        dayGuide,
      );
    }
    if (day.regionIds.length === 1) {
      day.overnightRegionId = day.regionIds[0];
    }
    const map = obj(card.map);
    day.sourceMetadata = {
      ...(typeof card.prototypeType === 'string' ? { prototypeType: card.prototypeType } : {}),
      mapCenter: z.tuple([z.number(), z.number()]).parse(map.center),
      mapZoom: z.number().parse(map.zoom),
    };
    for (const [stopIndex, stop] of arr(card.stops).entries()) {
      const item = plan.items.find((item) => item.activityId === `${day.dayId}-${str(stop.id)}`)!;
      item.executionNote = text(stop.executionNote);
      if (typeof stop.officialUrl === 'string' && stop.officialUrl) {
        item.officialUrl = stop.officialUrl;
      }
      if (typeof stop.lat === 'number' && typeof stop.lng === 'number') {
        const id = `activity-map-${item.activityId}`;
        add(
          'map-target',
          id,
          {
            mapKind: 'place',
            label: item.title,
            query: item.title,
            lat: stop.lat,
            lng: stop.lng,
            approximate: true,
            private: stop.category === 'hotel',
            verificationStatus: 'source-only-unverified',
            evidenceRefs: [],
          },
          path,
          `${path}#/stops/${stopIndex}`,
        );
        item.mapTargetId = id;
      }
    }
  }
  const factPath = 'data/place-facts.json';
  const factSource = json(factPath);
  for (const [slug, value] of Object.entries(obj(factSource.places))) {
    if (selectedPlaces.includes(slug)) {
      show(factPath, `/places/${escaped(slug)}`, value, `${slug} · 구조화 사실의 원문`);
    } else {
      defer(factPath, `/places/${escaped(slug)}`);
    }
  }
  for (const key of Object.keys(factSource).filter((key) => key !== 'places')) {
    show(factPath, `/${escaped(key)}`, factSource[key], `사실 자료의 ${key}`);
  }
  for (const fact of contents.filter((content) => content.kind === 'fact')) {
    if (!fact.payload.evidenceRefs.length) {
      const evidenceId = `local-${fact.entityId}`;
      const locator = fact.sourceRefs[0].locator;
      add(
        'evidence',
        evidenceId,
        {
          sourceType: 'local',
          sourceUrlOrRef: `${extract.sourceRepository}@${extract.sourceCommit}:${locator}`,
          label: '원천 값의 위치 · 외부 검증 근거 없음',
          claim: '이 값이 원천에 있었음을 보존. 사실성·최신성을 검증한 근거가 아님.',
          relatedRefs: [fact.payload.targetRef],
        },
        factPath,
        locator,
      );
      fact.payload.evidenceRefs = [ref('evidence', evidenceId)];
      fact.payload.appReviewStatus = 'needs-review';
      fact.payload.blockedReason = [
        fact.payload.blockedReason,
        '외부 근거 누락. 원천 값만 보존했으며 사용 전 재확인 필요.',
      ]
        .filter(Boolean)
        .join(' ');
      warnings.push(`FACT_EXTERNAL_SOURCE_MISSING:${fact.entityId}`);
    }
  }
  const mapPath = 'data/map-queries.json';
  const maps = json(mapPath);
  for (const [group, value] of Object.entries(maps)) {
    if (['places', 'hotels', 'stops', 'routes'].includes(group)) {
      if (!Object.keys(obj(value)).length) {
        meta(mapPath, group);
      }
      for (const [key, target] of Object.entries(obj(value))) {
        const selected =
          group === 'places'
            ? selectedPlaces.includes(key)
            : group === 'hotels'
              ? plan.days.some(
                  (day) =>
                    obj(json(`data/daily-cards/day-${day.dayId.slice(4).padStart(2, '0')}.json`).hotel).name === key,
                )
              : options.days.some((day) => key.startsWith(`day-${day}:`));
        if (selected) {
          show(mapPath, `/${group}/${escaped(key)}`, target, `${group} · ${key}`);
        } else {
          defer(mapPath, `/${group}/${escaped(key)}`);
        }
      }
    } else if (group === 'nonMapStops') {
      // This source is a list; keep each explicit stop key's scope visible in the correspondence report.
      if (Array.isArray(value) && value.length) {
        for (const [index, stop] of value.entries()) {
          if (options.days.some((day) => text(stop).includes(`day-${day}:`))) {
            show(mapPath, `/${group}/${index}`, stop, '지도 제외 활동 · 원천 사유');
          } else {
            defer(mapPath, `/${group}/${index}`);
          }
        }
      } else if (value && typeof value === 'object' && Object.keys(value).length) {
        for (const [key, stop] of Object.entries(obj(value))) {
          if (options.days.some((day) => key.startsWith(`day-${day}:`))) {
            show(mapPath, `/${group}/${escaped(key)}`, stop, '지도 제외 활동 · 원천 사유');
          } else {
            defer(mapPath, `/${group}/${escaped(key)}`);
          }
        }
      } else {
        meta(mapPath, group);
      }
    } else {
      show(mapPath, `/${escaped(group)}`, value, `지도 자료의 ${group}`);
    }
  }
  for (const basename of ['region-essentials', 'transit-facts', 'transit-resources', 'tourist-maps']) {
    const path = `data/${basename}.json`;
    const data = json(path);
    for (const [region, value] of Object.entries(obj(data.regions))) {
      if (!selectedRegions.includes(region)) {
        defer(path, `/regions/${escaped(region)}`);
        continue;
      }
      show(path, `/regions/${escaped(region)}`, value, `${region} · ${basename}`);
      const ownerRef: TargetRef = { tripId, targetKind: 'region', entityId: region };
      if (basename === 'region-essentials') {
        const essentials = obj(value);
        add(
          'guide',
          `essentials-${region}`,
          {
            documentKind: 'region-essentials',
            ownerRef,
            title: '생활·도착·귀가 안내',
            language: 'ko',
            sections: [],
            factBindings: [],
            assetRefs: [],
            structuredData: {
              staySummary: essentials.staySummary,
              lifeEssentials: essentials.lifeEssentials,
              arrivalStrategy: essentials.arrivalStrategy,
              departureStrategy: essentials.departureStrategy,
              lateReturnRule: essentials.lateReturnRule,
              evidenceRefs: [],
            },
          },
          path,
        );
      }
      if (basename === 'transit-facts') {
        const transit = obj(value);
        add(
          'guide',
          `transit-${region}`,
          {
            documentKind: 'transit',
            ownerRef,
            title: '교통권과 이용 안내',
            language: 'ko',
            sections: [],
            factBindings: [],
            assetRefs: [],
            structuredData: {
              recommendation: `${text(obj(transit.recommendation).title)} · ${text(obj(transit.recommendation).summary)}`,
              products: arr(transit.products === undefined ? [] : transit.products).map((product, index) => ({
                id: `product-${index}`,
                title: product.name,
                priceText: text(product.price),
                sharingText: product.shared === true ? '공유 가능 · 원천 표기' : '공유 불가 · 원천 표기',
                accessConditions: [text(product.accessNote)],
                suitability: text(product.fit),
              })),
              howToUse: transit.howToUse,
              exceptions: transit.exceptions,
              itineraryUses: arr(transit.itineraryUses)
                .filter((use) => options.days.includes(z.number().parse(use.day)))
                .map((use) => ({
                  planVersionId: plan.planVersionId,
                  dayIds: [`day-${use.day}`],
                  description: text(use.label),
                })),
              evidenceRefs: [],
            },
          },
          path,
        );
      }
    }
    for (const key of Object.keys(data).filter((key) => key !== 'regions')) {
      meta(path, key);
    }
  }
  const phrasePath = 'data/travel-french-phrases.json';
  const phrases = json(phrasePath);
  add(
    'phrase-book',
    'source-french',
    {
      locale: phrases.language,
      note: phrases.note_ko,
      categories: [...new Set(arr(phrases.phrases).map((phrase) => str(phrase.category)))],
      phrases: arr(phrases.phrases).map((phrase) => ({
        id: phrase.id,
        category: phrase.category,
        priority: { P0: 0, P1: 1, P2: 2 }[z.enum(['P0', 'P1', 'P2']).parse(phrase.priority)],
        text: phrase.fr,
        translation: phrase.ko,
        pronunciationHint: phrase.pronunciation_hint,
        usageNote: phrase.usage_note,
        tags: phrase.tags,
        audioText: phrase.audio_text,
        aliases: [],
        placeTypes: [],
        dayIds: [],
      })),
      contextRecommendations: [],
    },
    phrasePath,
  );
  show(phrasePath, '', phrases, '프랑스어 회화 · 원천 분류·우선순위 대조');
  const phraseBook = contents.find((content) => content.kind === 'phrase-book' && content.entityId === 'source-french');
  for (const name of ['DAY_FRENCH_MAP', 'PLACE_CATEGORY_FRENCH_MAP', 'FRENCH_CATEGORY_LABEL']) {
    const key = `build/render.py:${name}`;
    const entry = extract.entries.find((entry) => entry.sourceKey === key);
    if (!entry) {
      continue;
    }
    show(key, '', entry.rawValue, `회화 추천 원천 · ${name}`);
    if (phraseBook?.kind !== 'phrase-book' || name === 'FRENCH_CATEGORY_LABEL') {
      continue;
    }
    for (const [contextKey, rawIds] of Object.entries(obj(entry.rawValue))) {
      const ids = z.array(z.string()).parse(rawIds);
      if (ids.some((id) => !phraseBook.payload.phrases.some((phrase) => phrase.id === id))) {
        throw new Error('회화 추천의 원천 문구가 없습니다.');
      }
      const dayId = name === 'DAY_FRENCH_MAP' ? `day-${contextKey}` : undefined;
      if (dayId && !plan.days.some((day) => day.dayId === dayId)) {
        continue;
      }
      phraseBook.payload.contextRecommendations.push({
        ...(dayId ? { planVersionId: plan.planVersionId } : { placeType: contextKey }),
        dayIds: dayId ? [dayId] : [],
        phraseIds: ids,
      });
      for (const phrase of phraseBook.payload.phrases.filter((phrase) => ids.includes(phrase.id))) {
        if (dayId) {
          phrase.dayIds.push(dayId);
          phrase.planVersionId = plan.planVersionId;
        } else {
          phrase.placeTypes.push(contextKey);
        }
      }
    }
  }
  const languagePath = 'data/travel-french-guide.json';
  const language = json(languagePath);
  add(
    'guide',
    'source-french-guide',
    {
      documentKind: 'language-guide',
      ownerRef: tripRef,
      title: '프랑스어 발음·표지·메뉴',
      language: 'ko',
      sections: [],
      factBindings: [],
      assetRefs: [],
      structuredData: {
        pronunciationRules: arr(language.pronunciation_rules).flatMap((group) => arr(group.rules)),
        signsAndMenu: arr(language.signs_and_menu).flatMap((group) =>
          arr(group.words).map((word) => ({ text: word.fr, translation: word.ko, pronunciation: word.pronunciation })),
        ),
      },
    },
    languagePath,
  );
  show(languagePath, '', language, '발음·표지 원천의 분류와 보충');
  const workbook = mapSpfrWorkbook(
    extract,
    coverage,
    plan,
    selectedRegions,
    (id, payload, locator) => add('booking', id, payload, workbookPath, locator),
    options.fullSourceScope,
  );
  guide('source-workbook', '운영 통합문서 · 12시트 대조', workbook.sections, workbookPath);
  const fieldState = await mapSpfrFieldState(extract, plan, contents);
  dataset.records.push(...fieldState.records);
  blocking.push(...fieldState.errors);
  const codePath = 'build/render.py:PARIS_MUSEUM_BOOKINGS';
  const code = extract.entries.find((entry) => entry.sourceKey === codePath)!;
  for (const [index, booking] of arr(code.rawValue).entries()) {
    if (options.days.includes(z.number().parse(booking.day))) {
      show(codePath, `/${index}`, booking, '코드에 보관된 예약 원천 · 날짜·상태·대안');
    } else {
      defer(codePath, `/${index}`);
    }
  }
  for (const [index, entry] of extract.entries
    .filter((entry) => /^build\/render\.py:prose-/.test(entry.sourceKey))
    .entries()) {
    const prose = obj(entry.rawValue);
    const id = `source-common-prose-${index}`;
    guide(
      id,
      `원천 공통 안내 · ${str(prose.title)}`,
      [
        section(
          'notice',
          '원천 안내의 시점',
          '고정 원천의 안내입니다. 예약 상태·날짜·연락처의 최신성을 새로 확인한 내용이 아닙니다.',
        ),
        section('body', '원천 본문', str(prose.bodyMd), 1),
      ],
      'build/render.py',
    );
    coverage.mark(
      entry.sourceKey,
      '',
      'displayed',
      `guide/${id}`,
      'AST로 읽은 명시적 정적 안내. 동적 실행 결과는 만들지 않음',
    );
    if (arr(prose.dynamicExpressions).length) {
      blocking.push(`COMMON_PROSE_DYNAMIC_REVIEW_REQUIRED:${entry.sourceKey}`);
    }
  }
  for (const basename of ['field-notes', 'booking-overrides']) {
    const path = `data/${basename}.json`;
    const data = json(path);
    for (const [key, value] of Object.entries(data)) {
      if (['version', 'note'].includes(key)) {
        show(path, `/${key}`, value, `현장 원천의 ${key}`);
        continue;
      }
      const values = value !== null && typeof value === 'object' ? Object.entries(value) : [];
      if (!values.length) {
        meta(path, key);
      }
      for (const [child, record] of values) {
        const recordObject = obj(record);
        const entity = recordObject.entity ? obj(recordObject.entity) : undefined;
        const entityKey = entity ? text(entity.key) : child;
        const inPilot = options.days.some((day) => entityKey === `day-${day}` || entityKey.startsWith(`day-${day}/`));
        const locator = `${path}#/${key}/${escaped(child)}`;
        if (fieldState.imported.has(locator)) {
          show(path, `/${key}/${escaped(child)}`, record, '원천 메모·체크·예약 상태 · 시각/작성자 대조');
        } else if (inPilot) {
          blocking.push(`FIELD_STATE_ADAPTER_REQUIRED:${locator}`);
          show(path, `/${key}/${escaped(child)}`, record, '미적용 현장 상태 · 대응 검토 필요');
        } else {
          defer(path, `/${key}/${escaped(child)}`);
        }
      }
    }
  }
  // Markdown is rendered as Markdown, not a JSON dump. Preserve frontmatter separately for inspection.
  for (const entry of extract.entries.filter((entry) => entry.sourceKey.endsWith('.md'))) {
    const path = entry.sourceKey;
    const rawMd = str(entry.rawValue);
    const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(rawMd);
    if (path.includes('/30_Places/')) {
      const slug = path.split('/').at(-1)!.slice(0, -3);
      const existing = contents.find((content) => content.kind === 'guide' && content.entityId === `guide-${slug}`);
      if (existing?.kind !== 'guide') {
        throw new Error('장소 본문 대응 누락');
      }
      existing.payload.sections.push(
        section(
          'source-frontmatter',
          '원천 장소 속성',
          front ? '```text\n' + front[1] + '\n```' : '속성 없음',
          existing.payload.sections.length,
        ),
      );
      coverage.mark(path, '', 'displayed', `guide/${existing.entityId}`, '장소 본문 전체와 원천 속성을 분리 표시');
    } else if (path.includes('/20_Regions/')) {
      const slug = path.split('/').at(-1)!.slice(0, -3);
      const id = `region-guide-${slug}`;
      guide(
        id,
        `${slug} · 지역 가이드`,
        [
          section('body', '지역 본문', front ? rawMd.slice(front[0].length) : rawMd),
          section('source-frontmatter', '원천 지역 속성', front ? '```text\n' + front[1] + '\n```' : '속성 없음', 1),
        ],
        path,
        { tripId, targetKind: 'region', entityId: slug },
        'region-guide',
      );
      const region = contents.find((content) => content.kind === 'region' && content.entityId === slug);
      if (region?.kind === 'region') {
        region.payload.guideIds.push(id, `essentials-${slug}`, `transit-${slug}`);
      }
      coverage.mark(path, '', 'displayed', `guide/${id}`, '지역 본문 전체를 보존; 다른 날짜 언급도 지역 안내로 구분');
    } else if (path === 'source/ASSETS/91_Place_Registry_v1.0.md') {
      if (options.fullSourceScope) {
        guide(
          'source-registry',
          '전체 장소 레지스트리 · 원천 대조',
          [section('registry', '전체 원천 명부', rawMd)],
          path,
        );
        coverage.mark(path, '', 'displayed', 'guide/source-registry', '원천 명부 전체 보존. 방문 계획과 구분');
        continue;
      }
      const selected = rawMd
        .split(/\r?\n/)
        .filter((line) => selectedPlaces.some((slug) => line.startsWith(`| \`${slug}\` |`)));
      guide(
        'source-registry',
        `장소 레지스트리 · 표본 ${selectedPlaces.length}장소 대조`,
        [
          section(
            'registry',
            '선택 장소 원천 행',
            '| 슬러그 | 이름 | 타입 | 등급 | 지도 핀 | 본문 | 헤딩 | 위키 |\n|---|---|---|---|---|---|---|---|\n' +
              selected.join('\n'),
          ),
        ],
        path,
      );
      // The single raw Markdown leaf contains other regions too; do not claim that the entire registry was migrated.
      coverage.mark(
        path,
        '',
        'deferred',
        'guide/source-registry; Phase 2',
        '표본 장소 행만 화면 표시. 전체 레지스트리 본문·다른 장소는 Phase 2 보류',
      );
    } else if (path.startsWith('source/CURRENT/10_Core/') || path.startsWith('source/CURRENT/20_Regional_Chapters/')) {
      const id = `source-document-${(await digestBytes(new TextEncoder().encode(path))).slice(0, 24)}`;
      const title = /^#\s+(.+)$/m.exec(rawMd)?.[1] ?? path.split('/').at(-1)!;
      guide(id, title, [section('body', '원천 전체 본문', front ? rawMd.slice(front[0].length) : rawMd)], path);
      coverage.mark(
        path,
        '',
        'displayed',
        `guide/${id}`,
        '전체 원천 장/공통 안내를 원문으로 표시. 구조화 내용과 자동 병합하지 않음',
      );
    } else {
      blocking.push(`MARKDOWN_UNSUPPORTED:${path}`);
    }
  }
  const media = await mapSpfrMedia({
    extract,
    coverage,
    files: options.media,
    contents,
    plan,
    add,
    show,
    defer,
    warnings,
    allMedia: options.fullSourceScope,
  });
  for (const [path, group] of comparison) {
    const existing = contents.find((content) => content.kind === 'guide' && content.entityId === group.id);
    if (existing?.kind === 'guide') {
      existing.payload.sections.push(...group.sections);
      continue;
    }
    const day = plan.days.find((day) => group.id === `day-guide-${day.dayId}`);
    guide(
      group.id,
      day ? `${day.date} · 숙소·지도·원천 보충` : `원천 보충 · ${path.split('/').at(-1)}`,
      group.sections,
      path,
      day ? { tripId, targetKind: 'day', entityId: day.dayId, planVersionId: plan.planVersionId } : tripRef,
    );
  }
  const ledger = coverage.result();
  const unmapped = ledger.filter((row) => row.disposition === 'unmapped');
  if (unmapped.length) {
    blocking.push(`UNMAPPED_LEAF_FIELDS:${unmapped.length}`);
  }
  const correspondenceBytes = new TextEncoder().encode(
    JSON.stringify({ sourceCommit: extract.sourceCommit, rows: ledger }),
  );
  const correspondenceHash = await digestBytes(correspondenceBytes);
  const correspondence = add(
    'asset',
    'source-correspondence',
    {
      hash: correspondenceHash,
      mimeType: 'application/json',
      byteLength: correspondenceBytes.length,
      title: '원천 필드 대응표',
      assetKind: 'other',
      originalPath: 'generated/source-correspondence.json',
      evidenceRefs: [],
    },
    'generated/source-correspondence.json',
  );
  correspondence.sourceRefs[0].sourceKind = 'derived';
  const correspondenceGuide = guide(
    'source-correspondence-guide',
    '원천 필드 대응표 · 전체 항목과 보류 사유',
    [
      section(
        'about',
        '대응표 확인',
        '아래 JSON 첨부에서 원천 locator별 표시 위치·메타데이터·다음 배치 보류 사유를 확인할 수 있습니다. 이 파일도 전체 백업에 포함됩니다.',
      ),
    ],
    'generated/source-correspondence.json',
  );
  if (correspondenceGuide.kind === 'guide') {
    correspondenceGuide.payload.assetRefs.push({ assetId: correspondence.entityId, role: 'reference' });
  }
  bindSpfrFacts(contents);
  bindSpfrLinks(contents, warnings);
  splitSpfrGuides(contents);
  plan.reason = `고정 원천의 실제 ${options.days.length}일 배치 · 원천 상태와 미확인 사실을 보존`;
  plan.contextRefs = contents.map((content) => ({
    ...ref(content.kind, content.entityId),
    ...(content.kind === 'asset' ? { hash: content.payload.hash } : {}),
  }));
  dataset.heads = contents.map((content) => ({
    tripId,
    targetKind: content.kind,
    entityId: content.entityId,
    revisionId: content.revisionId,
    status: 'active',
  }));
  const validated = validateTripDataset(cloneJson(dataset));
  const report = {
    adapterVersion: 'spfr-pilot-v2',
    sourceCommit: extract.sourceCommit,
    scope: { days: options.days, dates, regions: selectedRegions, places: selectedPlaces },
    blocking: [...new Set(blocking)],
    packageReady: blocking.length === 0,
    warnings,
    coverage: {
      total: ledger.length,
      displayed: ledger.filter((row) => row.disposition === 'displayed').length,
      metadata: ledger.filter((row) => row.disposition === 'metadata').length,
      deferred: ledger.filter((row) => row.disposition === 'deferred').length,
      unmapped: unmapped.length,
    },
    workbook: workbook.counts,
    media,
    recordCount: dataset.records.length,
    uncertaintyPolicy:
      '외부 근거 없는 Fact는 원천 위치만 Evidence로 보존하고 needs-review 표시. 확인일·확정 방문·권리 허락을 발명하지 않음.',
    privateUseOnly: true,
    publicDistributionReviewed: false,
    correspondenceAsset: {
      entityId: correspondence.entityId,
      hash: correspondenceHash,
      byteLength: correspondenceBytes.length,
    },
    datasetDigest: await digestBytes(new TextEncoder().encode(JSON.stringify(validated))),
  };
  return {
    dataset: validated,
    mappings: currentMappings(validated),
    report,
    coverage: ledger,
    generatedAssets: new Map([[correspondenceHash, correspondenceBytes]]),
  };
}
