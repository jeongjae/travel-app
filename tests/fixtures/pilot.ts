import {
  contentRevisionSchema,
  digestBytes,
  type ContentRevision,
  type PlanVersion,
  type RevisionRef,
  type TripDataset,
} from '../../src/contracts/v2/index.ts';

// F-01/F-02 are invented. No SP-FR content, personal reservations or photographs.
const encoder = new TextEncoder();
const recordedAt = '2026-01-01T00:00:00Z';
const unknownTime = { precision: 'unspecified' } as const;
function pdfBytes() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = 'BT /F1 12 Tf 10 50 Td (Fictional pilot reference) Tj ET\n';
  objects.push(`<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}endstream`);
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj, index) => {
    offsets.push(encoder.encode(output).length);
    output += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = encoder.encode(output).length;
  output += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return encoder.encode(output);
}
export const fixtureAssets = {
  'asset-image': new Uint8Array(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      'base64',
    ),
  ),
  'asset-pdf': pdfBytes(),
};
export async function pilotTrip(short = false): Promise<TripDataset> {
  const tripId = short ? 'fixture-b' : 'fixture-a',
    planVersionId = 'plan-1';
  const dates = short ? ['2031-05-18'] : ['2026-10-31', '2026-11-01', '2026-11-02'];
  const contents: ContentRevision[] = [];
  const add = (kind: ContentRevision['kind'], entityId: string, payload: unknown) => {
    const c = contentRevisionSchema.parse({
      tripId,
      kind,
      entityId,
      revisionId: 'r1',
      schemaVersion: 2,
      sourceRefs: [{ sourceKind: 'fixture', sourceKey: entityId, locator: entityId, sourcePath: 'synthetic/pilot' }],
      recordedAt,
      actor: 'import',
      commitSeq: 1,
      payload,
    });
    contents.push(c);
    return c;
  };
  const ref = (kind: ContentRevision['kind'], entityId: string): RevisionRef => ({
    tripId,
    targetKind: kind,
    entityId,
    revisionId: 'r1',
  });
  const owner = { tripId, targetKind: 'place', entityId: 'shared-source-slug' } as const;
  const regionIds = short ? ['region-1'] : ['region-1', 'region-2'];
  for (const [n, entityId] of regionIds.entries()) {
    add('region', entityId, { name: `가상 지역 ${n + 1}`, guideIds: [], assetRefs: [] });
  }
  const placeIds = short ? ['shared-source-slug'] : ['shared-source-slug', 'place-2', 'place-3', 'place-4'];
  for (const [n, entityId] of placeIds.entries()) {
    add('place', entityId, {
      regionIds: [regionIds[n % regionIds.length]],
      name: short ? '가상 전시관 B' : `가상 장소 ${n + 1}`,
      aliases: [],
      placeKind: 'museum',
      summary: '실제 장소가 아닌 가상 표본',
      dontMiss: [],
      ...(n === 0 ? { guideId: 'guide-place', mapTargetId: 'map-place' } : {}),
      assetRefs: [],
    });
  }
  add('evidence', 'evidence-1', {
    sourceType: 'code',
    sourceUrlOrRef: 'synthetic/booking_literals.py:2',
    claim: '가상 표본 근거',
    relatedRefs: [owner],
  });
  add('fact', 'fact-opening', {
    targetRef: owner,
    key: 'opening',
    valueText: short ? '운영시간 미확인 B' : '가상 원문: 오후 개방',
    sourceConfidence: 'fixture-unverified',
    verifiedAt: { precision: 'date', date: '2026-01-01' },
    evidenceRefs: [ref('evidence', 'evidence-1')],
    appReviewStatus: 'unverified',
  });
  for (const [entityId, bytes] of Object.entries(fixtureAssets)) {
    add('asset', entityId, {
      hash: await digestBytes(bytes),
      mimeType: entityId === 'asset-image' ? 'image/png' : 'application/pdf',
      byteLength: bytes.length,
      title: `가상 ${entityId}`,
      assetKind: entityId === 'asset-image' ? 'image' : 'pdf',
      rightsHolder: 'travel-app synthetic fixture',
      license: 'CC0-1.0',
      evidenceRefs: [],
      originalPath: `synthetic/${entityId}`,
    });
  }
  const inline = [{ assetId: 'asset-image', role: 'inline' as const }];
  add('guide', 'guide-place', {
    documentKind: 'place-guide',
    ownerRef: owner,
    title: '가상 장소 본문',
    language: short ? 'ja' : 'en',
    sections: [
      {
        key: 'why_go',
        title: '왜 가는가',
        order: 0,
        bodyMd: '가상 본문. [주변 장소](travel://place/shared-source-slug)',
        factRefs: [],
        assetRefs: [],
        linkRefs: [owner],
      },
      {
        key: 'deep',
        title: '더 깊이',
        order: 1,
        bodyMd: '| 항목 | 설명 |\n| --- | --- |\n| 표본 | 가상 값 |\n\n![표본](asset://asset-image)',
        factRefs: [],
        assetRefs: inline,
        linkRefs: [],
      },
      {
        key: 'practical',
        title: '실용',
        order: 2,
        bodyMd: '시간: {{fact:opening}}',
        factRefs: ['fact-opening'],
        assetRefs: [],
        linkRefs: [],
      },
    ],
    factBindings: [{ token: 'opening', ref: ref('fact', 'fact-opening') }],
    assetRefs: [{ assetId: 'asset-pdf', role: 'reference' }],
  });
  add('map-target', 'map-place', {
    mapKind: 'place',
    label: '가상 지도 검색',
    query: 'Fictional pilot museum',
    approximate: true,
    private: false,
    verificationStatus: 'unverified',
    evidenceRefs: [],
  });
  add('booking', 'booking-code', {
    type: 'admission',
    title: '가상 코드 예약',
    placeId: owner.entityId,
    activityIds: ['activity-1'],
    planVersionId,
    time: { start: { precision: 'text', date: dates[0], rawText: '오후' } },
    status: 'needs-review',
    sourceStatusRaw: '가상 확인 필요',
    actionTiming: { precision: 'text', rawText: '판매 시작 시' },
    nextActionText: '가상 표본 확인',
    passNote: '가상 패스 설명',
    planB: '야외 산책',
    note: '예약 실행 아님',
  });
  add('task', 'task-1', {
    targetRef: { tripId, targetKind: 'booking', entityId: 'booking-code' },
    actionType: 'check',
    label: '예약 확인',
    detail: '가상 예약 상태 확인',
    meaningFingerprint: '1'.repeat(64),
  });
  add('phrase-book', 'phrases', {
    locale: short ? 'ja-JP' : 'en-GB',
    categories: ['help'],
    phrases: [
      {
        id: 'phrase-1',
        category: 'help',
        priority: 1,
        text: short ? 'こんにちは' : 'Hello',
        translation: '안녕하세요',
        pronunciationHint: '',
        usageNote: '가상 표본',
        tags: [],
        aliases: [],
        placeTypes: ['museum'],
        dayIds: ['day-1'],
        planVersionId,
      },
    ],
    contextRecommendations: [
      { placeType: 'museum', dayIds: ['day-1'], planVersionId, phraseIds: ['phrase-1'], order: 0 },
    ],
  });
  const contextRefs: RevisionRef[] = contents.map((c) => ({
    ...ref(c.kind, c.entityId),
    ...(c.kind === 'asset' ? { hash: c.payload.hash } : {}),
  }));
  const days = dates.map((date, n) => ({
    tripId,
    planVersionId,
    dayId: `day-${n + 1}`,
    ordinal: n + 1,
    date,
    cityText: `가상 지역 ${(n % regionIds.length) + 1}`,
    title: `가상 ${n + 1}일`,
    regionIds: [regionIds[n % regionIds.length]],
    time: { start: { precision: 'unspecified' as const, date } },
    transport: [],
    food: [],
    highlights: [],
    needsReview: [],
    assetRefs: [],
  }));
  const item = (n: number, day: number, placeId: string): PlanVersion['items'][number] => ({
    tripId,
    planVersionId,
    activityId: `activity-${n}`,
    dayId: `day-${day}`,
    order: n,
    title: `가상 활동 ${n}`,
    category: 'visit',
    time: { start: unknownTime },
    summary: '',
    optional: false,
    placeLinks: [{ placeId, relation: 'visit' }],
    bookingIds: n === 1 ? ['booking-code'] : [],
    taskRefs: n === 1 ? [ref('task', 'task-1')] : [],
    executionMarkers: [],
    sourceFlags: [],
  });
  const items = short
    ? [item(1, 1, owner.entityId)]
    : [
        item(1, 1, owner.entityId),
        item(2, 1, 'place-2'),
        item(3, 2, owner.entityId),
        item(4, 3, 'place-3'),
        item(5, 3, 'place-4'),
      ];
  if (!short) {
    items[2].time = {
      start: {
        precision: 'instant',
        date: dates[1],
        localTime: '01:30',
        timeZone: 'America/New_York',
        offset: '-05:00',
        instant: '2026-11-01T06:30:00Z',
      },
    };
  }
  // One confirmed local time without inventing an instant.
  if (!short) {
    items[3].time = { start: { precision: 'local', date: dates[2], localTime: '10:00', timeZoneStatus: 'unknown' } };
  }
  return {
    domainSchemaVersion: 2,
    header: {
      tripId,
      name: short ? '가상 미술 여행 B' : '가상 산책 여행 A',
      startDate: dates[0],
      endDate: dates.at(-1)!,
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
    plans: [
      {
        tripId,
        planVersionId,
        number: 1,
        reason: '가상 초기 계획',
        createdAt: recordedAt,
        commitSeq: 1,
        contextRefs,
        days,
        items,
        legs: short
          ? []
          : [
              {
                tripId,
                planVersionId,
                legId: 'leg-1',
                dayId: 'day-1',
                fromActivityId: 'activity-1',
                toActivityId: 'activity-2',
                mode: 'walk',
                durationText: '약 10분',
                geometryStatus: 'unresolved',
              },
            ],
        stays: short
          ? []
          : [
              {
                tripId,
                planVersionId,
                stayId: 'stay-1',
                regionId: 'region-1',
                baseText: '가상 숙박 거점',
                time: { start: { precision: 'date', date: dates[0] }, end: { precision: 'date', date: dates[2] } },
                plannedNights: 2,
              },
            ],
      },
    ],
    records: [
      {
        tripId,
        recordId: 'legacy-1',
        kind: 'legacy-state',
        recordedAt,
        sourceRefs: [],
        commitSeq: 1,
        payload: {
          targetRef: owner,
          state: 'visited',
          sourceKey: 'fixture-visited',
          note: '방문 시각 없는 기존 체크 표본',
        },
      },
      {
        tripId,
        recordId: 'actual-1',
        kind: 'actual',
        recordedAt,
        sourceRefs: [],
        commitSeq: 1,
        payload: {
          title: '가상 예정 외 활동',
          targetSummary: '가상 장소',
          outcome: 'unplanned',
          time: { start: unknownTime },
          note: '발생 시각 미상',
          contextRefs,
        },
      },
    ],
    proposals: [
      {
        tripId,
        proposalId: 'proposal-1',
        proposalRevisionId: 'p1',
        proposalRevision: 1,
        baseDomainRevision: 0,
        basePlanVersionId: planVersionId,
        origin: 'ai',
        operations: [{ type: 'upsert-item', item: { ...items[0], title: '아직 미적용인 가상 변경안' } }],
        reason: '모의 변경안',
        evidenceRefs: [ref('evidence', 'evidence-1')],
        impact: { activityIds: ['activity-1'], reservationText: '가상 예약 영향 확인' },
        status: 'pending',
        commitSeq: 2,
      },
    ],
  };
}

export const invalidFixtures: Record<string, (t: TripDataset) => void> = {
  'cross-trip': (t) => {
    const c = t.contents.find((c) => c.kind === 'guide')!;
    if (c.kind === 'guide') {
      c.payload.ownerRef.tripId = 'fixture-b';
    }
  },
  'duplicate-id': (t) => {
    t.contents.push(structuredClone(t.contents[0]));
  },
  'broken-fact': (t) => {
    const c = t.contents.find((c) => c.kind === 'guide')!;
    if (c.kind === 'guide') {
      c.payload.sections[2].bodyMd = '{{fact:missing}}';
    }
  },
  'broken-asset': (t) => {
    t.contents = t.contents.filter((c) => c.entityId !== 'asset-image');
    t.heads = t.heads.filter((c) => c.entityId !== 'asset-image');
    t.plans[0].contextRefs = t.plans[0].contextRefs.filter((c) => c.entityId !== 'asset-image');
  },
  'broken-activity': (t) => {
    t.plans[0].legs[0].toActivityId = 'missing';
  },
  'incomplete-context': (t) => {
    t.plans[0].contextRefs = t.plans[0].contextRefs.filter((c) => c.targetKind !== 'evidence');
  },
  'broken-link': (t) => {
    const c = t.contents.find((c) => c.kind === 'guide')!;
    if (c.kind === 'guide') {
      c.payload.sections[0].bodyMd = '[오류](travel://place/missing)';
    }
  },
};
