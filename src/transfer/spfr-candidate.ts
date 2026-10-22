import { z } from 'zod';
import {
  canonicalJson,
  contentRevisionSchema,
  digestBytes,
  sourceExtractSchema,
  timeSpecSchema,
  validateTripDataset,
  type ContentRevision,
  type PlanVersion,
  type RevisionRef,
  type TimeSpec,
} from '../contracts/v2/index.ts';
import { currentMappings } from './normalize.ts';

const object = (v: unknown) => z.record(z.string(), z.unknown()).parse(v);
const objects = (v: unknown) => z.array(z.record(z.string(), z.unknown())).parse(v);
const string = (v: unknown) => z.string().parse(v);
const optionalString = (v: unknown) => (typeof v === 'string' ? v : undefined);
const list = (v: unknown) => z.array(z.string()).parse(v);
const text = (v: unknown) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : canonicalJson(v));
const pathFor = (day: number) => `data/daily-cards/day-${String(day).padStart(2, '0')}.json`;
// Omit optional adapter fields, never feed explicit undefined into the v2 JSON boundary.
const plain = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

/** A validated candidate only. The report intentionally prevents packaging incomplete source coverage. */
export async function normalizeSpfrCandidate(
  raw: unknown,
  options: { days: number[]; tripId: string; createdAt: string },
) {
  const extract = sourceExtractSchema.parse(raw),
    contents: ContentRevision[] = [],
    tripId = options.tripId,
    planVersionId = 'source-plan-1';
  if (!options.days.length || new Set(options.days).size !== options.days.length)
    throw new Error('중복 없는 대표 일자가 필요합니다.');
  const mapped: { sourceKey: string; target: string; note: string }[] = [];
  const blocking = [
    'XLSX_MAPPING_PENDING',
    'MEDIA_MAPPING_PENDING',
    'REGION_LANGUAGE_FIELD_STATE_MAPPING_PENDING',
    'FULL_FIELD_COVERAGE_PENDING',
  ];
  if (extract.unresolved.length) blocking.push('UNRESOLVED_SOURCE');
  const entry = (path: string) => {
    const e = extract.entries.find((e) => e.sourceKey === path);
    if (!e || e.status !== 'extracted') throw new Error(`원천 누락/미해결: ${path}`);
    return e;
  };
  const json = (path: string) => object(entry(path).rawValue);
  const source = (path: string, locator = path) => [
    {
      sourceKind: path.endsWith('.py') ? 'python' : path.endsWith('.md') ? 'markdown' : 'json',
      sourcePath: path,
      sourceKey: locator,
      locator,
    },
  ];
  const add = (kind: ContentRevision['kind'], entityId: string, payload: unknown, path: string, locator = path) => {
    const c = contentRevisionSchema.parse(
      plain({
        tripId,
        entityId,
        kind,
        revisionId: 'source-1',
        schemaVersion: 2,
        sourceRefs: source(path, locator),
        recordedAt: options.createdAt,
        actor: 'import',
        commitSeq: 1,
        payload,
      }),
    );
    contents.push(c);
    return c;
  };
  const ref = (targetKind: ContentRevision['kind'], entityId: string): RevisionRef => ({
    tripId,
    targetKind,
    entityId,
    revisionId: 'source-1',
  });
  const stable = async (prefix: string, key: string) =>
    `${prefix}-${(await digestBytes(new TextEncoder().encode(key))).slice(0, 24)}`;
  const cards = options.days
    .toSorted((a, b) => a - b)
    .map((day) => {
      const c = json(pathFor(day));
      if (c.day !== day) throw new Error('일일카드 번호가 다릅니다.');
      return c;
    });
  const dates = cards.map((c) => string(c.date)),
    itinerary = json('source/CURRENT/10_Core/itinerary.json');
  const stays = objects(itinerary.stays).filter((s) =>
    dates.some((d) => string(s.checkin) <= d && d < string(s.checkout)),
  );
  const regionIds = [...new Set(stays.map((s) => string(s.key)))],
    regions = objects(json('source/CURRENT/10_Core/regions.json').regions);
  for (const regionId of regionIds) {
    const r = regions.find((r) => r.slug === regionId);
    if (!r) throw new Error('지역 원천 누락');
    add(
      'region',
      regionId,
      {
        name: r.name,
        nameKo: optionalString(r.nameKo),
        countryCode: optionalString(r.country),
        tagline: optionalString(r.tagline),
        introduction: optionalString(r.dek),
        intensity: optionalString(r.intensity),
        budgetText: optionalString(r.budget),
        rainPlan: optionalString(r.rainPlan),
        guideIds: [],
        assetRefs: [],
      },
      'source/CURRENT/10_Core/regions.json',
      `source/CURRENT/10_Core/regions.json#/regions/${regions.indexOf(r)}`,
    );
  }
  const time = (value: unknown, date: string): TimeSpec =>
    timeSpecSchema.parse(
      value === null || value === undefined || value === ''
        ? { precision: 'unspecified', date }
        : typeof value === 'string' && /^\d{2}:\d{2}$/.test(value)
          ? { precision: 'local', date, localTime: value, timeZoneStatus: 'unknown' }
          : { precision: 'text', date, rawText: text(value) },
    );
  const range = (start: unknown, end: unknown, date: string) => ({
    start: time(start, date),
    ...(end !== null && end !== undefined && end !== '' ? { end: time(end, date) } : {}),
  });
  const plan: PlanVersion = {
    tripId,
    planVersionId,
    number: 1,
    reason: '고정 원천의 대표 후보 · 적용 전 검증 필요',
    createdAt: options.createdAt,
    commitSeq: 1,
    contextRefs: [],
    days: [],
    items: [],
    legs: [],
    stays: [],
  };
  const places = new Map<string, Record<string, unknown>>();
  for (const c of cards) {
    const day = z.number().int().positive().parse(c.day),
      dayId = `day-${day}`,
      date = string(c.date),
      path = pathFor(day);
    const localRegions = stays
      .filter((s) => string(s.checkin) <= date && date < string(s.checkout))
      .map((s) => string(s.key));
    if (!localRegions.length) throw new Error('명시적인 숙박 지역이 없습니다.');
    plan.days.push({
      tripId,
      planVersionId,
      dayId,
      ordinal: plan.days.length + 1,
      date,
      cityText: string(c.city),
      title: string(c.title),
      dayType: optionalString(c.dayType),
      regionIds: localRegions,
      time: range(c.startTime, c.endTime, date),
      durationText: optionalString(c.totalDuration),
      distanceText: optionalString(c.totalDistance),
      fatigueText: c.fatigue === null ? undefined : text(c.fatigue),
      transport: list(c.transport),
      food: list(c.food),
      highlights: list(c.highlights),
      backupText: optionalString(c.backup),
      needsReview: list(c.needsReview),
      sourceStatus: optionalString(c.sourceStatus),
      assetRefs: [],
    });
    const stops = objects(c.stops);
    for (const stop of stops) {
      const rawId = string(stop.id),
        activityId = `${dayId}-${rawId}`,
        placeId = optionalString(stop.place_ref);
      if (placeId) places.set(placeId, stop);
      plan.items.push({
        tripId,
        planVersionId,
        activityId,
        dayId,
        order: z.number().int().nonnegative().parse(stop.order),
        title: string(stop.name),
        category: string(stop.category),
        time: range(stop.start, stop.end, date),
        summary: string(stop.summary),
        ...(optionalString(stop.menu) ? { menuText: string(stop.menu) } : {}),
        ...(optionalString(stop.reservation) ? { reservationText: string(stop.reservation) } : {}),
        optional: z.boolean().parse(stop.optional),
        placeLinks: placeId ? [{ placeId, relation: 'visit' }] : [],
        bookingIds: [],
        taskRefs: [],
        executionMarkers: objects(stop.executionStatuses).map((s) => ({
          type: string(s.type),
          label: string(s.label),
          detail: typeof s.detail === 'string' ? s.detail : '',
        })),
        sourceFlags: [],
      });
    }
    for (const [i, l] of objects(c.legs).entries())
      plan.legs.push({
        tripId,
        planVersionId,
        legId: `${dayId}-leg-${i}`,
        dayId,
        fromActivityId: `${dayId}-${string(l.from)}`,
        toActivityId: `${dayId}-${string(l.to)}`,
        mode: string(l.mode),
        durationText: optionalString(l.duration),
        distanceText: optionalString(l.distance),
        lineText: optionalString(l.line),
        geometryStatus: optionalString(l.geometryStatus),
      });
    mapped.push({
      sourceKey: path,
      target: `plan/${dayId}`,
      note: '일자/활동/이동 의미 필드 후보. hotel/map/sourceRefs 및 확장 필드는 미완료 보고서에 보존.',
    });
  }
  const facts = object(json('data/place-facts.json').places),
    maps = object(json('data/map-queries.json').places);
  for (const [slug, stop] of places) {
    const path = `source/CURRENT/30_Places/${slug}.md`,
      rawMd = string(entry(path).rawValue),
      front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(rawMd);
    if (!front) throw new Error('명시적 장소 frontmatter가 필요합니다.');
    const values = new Map<string, string>();
    for (const line of front[1].split(/\r?\n/)) {
      const m = /^([a-z_]+):\s*(.*)$/.exec(line);
      if (!m) {
        blocking.push(`FRONTMATTER_UNSUPPORTED:${slug}`);
        continue;
      }
      if (values.has(m[1])) throw new Error('중복 frontmatter');
      const v = m[2];
      values.set(m[1], v.startsWith('"') ? string(JSON.parse(v)) : v);
    }
    if (values.get('slug') !== slug || !regionIds.includes(values.get('region') ?? ''))
      throw new Error('장소 ID/지역이 다릅니다.');
    const map = maps[slug] ? object(maps[slug]) : undefined,
      mapId = `map-${slug}`;
    add(
      'map-target',
      mapId,
      {
        mapKind: 'place',
        label: values.get('name') ?? slug,
        query: map ? string(map.query) : string(stop.name),
        ...(typeof stop.lat === 'number' && typeof stop.lng === 'number' ? { lat: stop.lat, lng: stop.lng } : {}),
        approximate: true,
        private: false,
        verificationStatus: 'source-only-unverified',
        ...(map && typeof map.verdict === 'string' ? { sourceVerdict: map.verdict } : {}),
        ...(map && typeof map.resolvedName === 'string' ? { resolvedName: map.resolvedName } : {}),
        evidenceRefs: [],
      },
      'data/map-queries.json',
      `data/map-queries.json#/places/${slug}`,
    );
    add(
      'place',
      slug,
      {
        regionIds: [values.get('region')!],
        name: values.get('name') ?? slug,
        aliases: values.has('local_name') ? [values.get('local_name')!] : [],
        placeKind: values.get('kind') ?? 'unspecified',
        ...(values.has('grade') ? { grade: values.get('grade') } : {}),
        summary: values.get('summary') ?? '',
        dontMiss: [],
        guideId: `guide-${slug}`,
        mapTargetId: mapId,
        assetRefs: [],
      },
      path,
    );
    const factBindings: { token: string; ref: RevisionRef }[] = [],
      factIds: string[] = [];
    if (facts[slug])
      for (const [key, value] of Object.entries(object(object(facts[slug]).facts))) {
        const f = object(value),
          factId = await stable('fact', `${slug}:${key}`),
          evidenceId = await stable('evidence', `${slug}:${key}`),
          where = `data/place-facts.json#/places/${slug}/facts/${key}`,
          sourceText = optionalString(f.source),
          evidenceRefs: RevisionRef[] = [];
        if (sourceText) {
          add(
            'evidence',
            evidenceId,
            {
              sourceType: /^https?:\/\//.test(sourceText) ? 'web' : 'local',
              sourceUrlOrRef: sourceText,
              claim: text(f.value),
              ...(optionalString(f.verified_at)
                ? { sourceVerifiedAt: { precision: 'date', date: f.verified_at } }
                : {}),
              relatedRefs: [{ tripId, targetKind: 'place', entityId: slug }],
            },
            'data/place-facts.json',
            where,
          );
          evidenceRefs.push(ref('evidence', evidenceId));
        } else blocking.push(`FACT_SOURCE_MISSING:${slug}:${key}`);
        add(
          'fact',
          factId,
          {
            targetRef: { tripId, targetKind: 'place', entityId: slug },
            key,
            valueText: text(f.value),
            sourceConfidence: optionalString(f.confidence) ?? 'unknown',
            ...(optionalString(f.verified_at) ? { verifiedAt: { precision: 'date', date: f.verified_at } } : {}),
            ...(optionalString(f.blocked_reason) ? { blockedReason: f.blocked_reason } : {}),
            evidenceRefs,
            appReviewStatus: 'unverified',
          },
          'data/place-facts.json',
          where,
        );
        factBindings.push({ token: key, ref: ref('fact', factId) });
        factIds.push(factId);
      }
    const body = rawMd.slice(front[0].length),
      sections: Extract<ContentRevision, { kind: 'guide' }>['payload']['sections'] = [];
    const pieces = body.split(/^## /m);
    if (pieces[0].trim()) blocking.push(`GUIDE_PREAMBLE_PENDING:${slug}`);
    for (const [i, piece] of pieces.slice(1).entries()) {
      const split = piece.indexOf('\n'),
        title = (split < 0 ? piece : piece.slice(0, split)).trim(),
        bodyMd = split < 0 ? '' : piece.slice(split + 1);
      const key = /왜 가는가/.test(title)
        ? 'why_go'
        : /더 깊이/.test(title)
          ? 'deep'
          : /실용/.test(title)
            ? 'practical'
            : await stable('section', title);
      if (/<\/?[A-Za-z]|!\[|travel:\/\/|asset:\/\//.test(bodyMd))
        blocking.push(`GUIDE_BINDINGS_PENDING:${slug}:${key}`);
      sections.push({ key, title, order: i, bodyMd, factRefs: [], assetRefs: [], linkRefs: [] });
    }
    // Keep narrative and structured source facts separately; never silently replace conflicting prose.
    if (factIds.length)
      sections.push({
        key: 'source-facts',
        title: '구조화 원천 사실 · 본문 대조 필요',
        order: sections.length,
        bodyMd: factBindings.map((b) => `${b.token}: {{fact:${b.token}}}`).join('\n\n'),
        factRefs: factIds,
        assetRefs: [],
        linkRefs: [],
      });
    add(
      'guide',
      `guide-${slug}`,
      {
        documentKind: 'place-guide',
        ownerRef: { tripId, targetKind: 'place', entityId: slug },
        title: values.get('name') ?? slug,
        language: 'ko',
        sections,
        factBindings,
        assetRefs: [],
      },
      path,
    );
    mapped.push({
      sourceKey: path,
      target: `place/${slug};guide/guide-${slug}`,
      note: '본문/구조화 사실을 분리 보존. 사진·관련 링크·소스 메타와 내용 충돌은 미완료.',
    });
  }
  const code = entry('build/render.py:PARIS_MUSEUM_BOOKINGS');
  for (const [index, b] of objects(code.rawValue).entries()) {
    const card = cards.find((c) => c.day === b.day);
    if (!card) continue;
    const id = await stable('booking', string(b.id)),
      date = string(card.date),
      slug = optionalString(b.slug),
      activityIds = slug
        ? plan.items
            .filter((i) => i.dayId === `day-${card.day}` && i.placeLinks.some((p) => p.placeId === slug))
            .map((i) => i.activityId)
        : [];
    add(
      'booking',
      id,
      {
        type: 'source-reservation',
        title: string(b.name),
        ...(regionIds.length === 1 ? { regionId: regionIds[0] } : {}),
        ...(slug && places.has(slug) ? { placeId: slug } : {}),
        activityIds,
        ...(activityIds.length ? { planVersionId } : {}),
        time: { start: { precision: 'text', date, rawText: string(b.schedule) } },
        status: string(b.canonical_status),
        sourceStatusRaw: string(b.canonical_status),
        stageText: text(b.stage),
        actionTiming: { precision: 'text', rawText: string(b.when) },
        nextActionText: text(b.action_date),
        passNote: text(b.pmp),
        planB: text(b.plan_b),
        note: text(b.note),
        ...(optionalString(b.official_url) ? { officialUrl: b.official_url } : {}),
      },
      'build/render.py',
      `${code.locator}[${index}]`,
    );
    for (const i of plan.items.filter((i) => activityIds.includes(i.activityId))) i.bookingIds.push(id);
    mapped.push({
      sourceKey: `${code.sourceKey}[${index}]`,
      target: `booking/${id}`,
      note: 'day→ISO 날짜 대응. M/D/요일·일정·구매/예약 원문은 그대로 보존하며 새 사용자 확인을 발명하지 않음.',
    });
  }
  plan.contextRefs = contents.map((c) => ref(c.kind, c.entityId));
  const dataset = validateTripDataset(
    plain({
      domainSchemaVersion: 2,
      header: {
        tripId,
        name: `SP-FR 대표 구간 Day ${options.days.toSorted((a, b) => a - b).join('·')}`,
        startDate: dates.toSorted()[0],
        endDate: dates.toSorted().at(-1),
        timeZoneStatus: 'unknown',
        domainRevision: 0,
        currentPlanVersionId: planVersionId,
      },
      heads: contents.map((c) => ({
        tripId,
        targetKind: c.kind,
        entityId: c.entityId,
        revisionId: c.revisionId,
        status: 'active',
      })),
      contents,
      plans: [plan],
      records: [],
      proposals: [],
    }),
  );
  return {
    dataset,
    mappings: currentMappings(dataset),
    report: {
      adapterVersion: 'spfr-candidate-v1',
      sourceCommit: extract.sourceCommit,
      mapped,
      blocking: [...new Set(blocking)],
      packageReady: false,
      rawSourcePreservedIn: 'extract.json',
      note: '후보 검증 성공은 전체 필드/첨부/원천 상태의 이행 완료가 아닙니다.',
    },
  };
}
