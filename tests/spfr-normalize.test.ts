import { expect, it } from 'vitest';
import { canonicalJson } from '../src/contracts/v2';
import { normalizeSpfrPilot } from '../src/transfer/spfr-pilot';
import { buildPackage, readPackage } from '../src/transfer/package';
import { reviewWorkspace, workspaceUrl } from '../src/storage/workspace-name';
import { spfrPilotFixture } from './fixtures/spfr-pilot';
import { spfrRegistryRows } from '../src/transfer/spfr-registry';

it('전체 원천 대응·명시 XLSX 날짜·오프라인 첨부·회화·미확인 근거를 분리하고 ZIP을 왕복한다', async () => {
  const fixture = await spfrPilotFixture();
  const result = await normalizeSpfrPilot(fixture.extract, fixture.options);
  expect(result.report.blocking).toEqual([]);
  expect(result.report.packageReady).toBe(true);
  expect(result.coverage.every((row) => row.disposition !== 'unmapped')).toBe(true);
  expect(new Set(result.coverage.map((row) => row.locator)).size).toBe(result.coverage.length);
  expect(
    result.coverage.some(
      (row) => row.locator.endsWith('Master Itinerary!M4#/value') && row.disposition === 'displayed',
    ),
  ).toBe(true);
  expect(
    result.coverage.some((row) => row.locator.endsWith('Master Itinerary!M5#/value') && row.disposition === 'deferred'),
  ).toBe(true);
  const contents = result.dataset.contents;
  expect(result.dataset.records).toEqual([]);
  expect(result.dataset.plans[0].items[0].executionNote).toBe('가상 보충');
  expect(result.dataset.plans[0].stays).toHaveLength(1);
  expect(result.dataset.plans[0].days[0].assetRefs).toHaveLength(1);
  const fact = contents.find((content) => content.kind === 'fact');
  expect(fact?.payload).toMatchObject({ valueText: '미상', appReviewStatus: 'needs-review' });
  if (fact?.kind !== 'fact') {
    throw new Error('Fact 누락');
  }
  expect(fact.payload.verifiedAt).toBeUndefined();
  const evidence = contents.find(
    (content) => content.kind === 'evidence' && content.entityId === fact.payload.evidenceRefs[0].entityId,
  );
  expect(evidence?.payload).toMatchObject({ sourceType: 'local' });
  expect(evidence?.payload).not.toHaveProperty('sourceVerifiedAt');
  expect(
    contents.find((content) => content.kind === 'booking' && content.entityId === 'xlsx-R001')?.payload,
  ).toMatchObject({
    time: { start: { date: '2033-05-01' } },
    status: '가상 미확정',
    privateDetails: { confirmationCode: 'SYNTHETIC-NUMBER' },
  });
  expect(contents.find((content) => content.kind === 'phrase-book')?.payload).toMatchObject({
    phrases: [{ priority: 0, audioText: 'Bonjour' }],
  });
  const packaged = await buildPackage(
    result.dataset,
    new Map([...fixture.options.media.map((file) => [file.sha256, file.bytes] as const), ...result.generatedAssets]),
    {
      sourceRepository: 'fiction/source',
      sourceCommit: 'a'.repeat(40),
      lineageId: 'fiction',
      adapterVersion: 'spfr-pilot-v2',
      normalizationVersion: '2',
    },
    result.report,
    result.mappings,
  );
  const reread = await readPackage(packaged.blob);
  expect(canonicalJson(reread.dataset)).toBe(canonicalJson(result.dataset));
  expect(reread.assets.size).toBe(2);
});

it('새 미대응 입력은 차단하고 메모를 원천 시각으로 보존하며 첨부 변조·빈 수식 캐시를 거부한다', async () => {
  const fixture = await spfrPilotFixture();
  const unknown = structuredClone(fixture.extract);
  unknown.entries.push({
    sourceKey: 'data/new.json',
    locator: 'data/new.json',
    sourceKind: 'json',
    rawValue: { added: true },
    status: 'extracted',
  });
  const result = await normalizeSpfrPilot(unknown, fixture.options);
  expect(result.report.packageReady).toBe(false);
  expect(result.report.blocking).toContain('UNMAPPED_LEAF_FIELDS:1');
  const state = structuredClone(fixture.extract);
  const notes = state.entries.find((entry) => entry.sourceKey === 'data/field-notes.json')!;
  const raw = notes.rawValue as { notes: { entity: { key: string } }[] };
  raw.notes[0].entity.key = 'day-28';
  const mapped = await normalizeSpfrPilot(state, fixture.options);
  expect(mapped.report.blocking).toEqual([]);
  expect(mapped.dataset.records).toHaveLength(1);
  expect(mapped.dataset.records[0]).toMatchObject({
    kind: 'note',
    recordedAt: '2033-04-30T09:00:00Z',
    payload: { targetRef: { targetKind: 'day', entityId: 'day-28' } },
  });
  const unsupported = structuredClone(state);
  const unsupportedNotes = unsupported.entries.find((entry) => entry.sourceKey === 'data/field-notes.json')!;
  (unsupportedNotes.rawValue as { unknown: Record<string, unknown> }).unknown = {
    'day-28': { ts: '2033-04-30T09:00:00Z' },
  };
  const blocked = await normalizeSpfrPilot(unsupported, fixture.options);
  expect(blocked.report.blocking).toContain('FIELD_GROUP_UNSUPPORTED:unknown');
  const tampered = structuredClone(fixture.options);
  tampered.media[0].bytes[0] ^= 1;
  await expect(normalizeSpfrPilot(fixture.extract, tampered)).rejects.toThrow('SHA-256');
  const formula = structuredClone(fixture.extract);
  const cell = formula.entries.find((entry) => entry.sourceKey.includes('Master Itinerary!M4'))!;
  cell.rawValue = { value: '=1+1', cellType: 'f', cachedValue: null };
  await expect(normalizeSpfrPilot(formula, fixture.options)).rejects.toThrow('수식 캐시');
});

it('검증 URL은 기존 DB 이름을 직접 선택할 수 없고 화면 전환에도 별도 공간을 유지한다', () => {
  expect(reviewWorkspace('?workspace=content&review=phase-1')).toBe('phase-1');
  expect(reviewWorkspace('?review=../travel-app')).toBeUndefined();
  expect(reviewWorkspace('?review=')).toBeUndefined();
  expect(workspaceUrl('legacy', '?review=phase-1')).toBe('?workspace=legacy&review=phase-1');
});

it('비일정 장소와 독립 본문 부재를 명시하고 다른 장소 Fact를 연결하되 방문을 만들지 않는다', async () => {
  const fixture = await spfrPilotFixture();
  const facts = fixture.extract.entries.find((entry) => entry.sourceKey === 'data/place-facts.json')!.rawValue as {
    places: Record<string, unknown>;
  };
  facts.places['fiction-only'] = {
    region: 'fiction',
    displayName: '가상 비일정 장소',
    facts: { hours: { value: '가상 오후', confidence: 'unknown' } },
  };
  const registry = fixture.extract.entries.find((entry) => entry.sourceKey.endsWith('91_Place_Registry_v1.0.md'))!;
  registry.rawValue += '\n## fiction (01)\n| `fiction-extra` | 가상 추가 안내 | spot | 선택 | — | — | — | — |\n';
  const path = 'source/CURRENT/30_Places/fiction-extra.md';
  const rawValue =
    '---\nslug: fiction-extra\nname: "가상 추가 안내"\nregion: fiction\nkind: spot\n---\n\n## 더 깊이\n<Fictional Exhibition> · {{fact:fiction-only.hours}} · {{badge:source|원천 재확인}}\n';
  fixture.extract.entries.push({
    sourceKey: path,
    locator: path,
    sourceKind: 'markdown',
    status: 'extracted',
    rawValue,
  });
  const options = {
    ...fixture.options,
    additionalPlaceIds: ['fiction-extra', 'fiction-only'],
    bodylessPlaceIds: ['fiction-only'],
  };
  const result = await normalizeSpfrPilot(fixture.extract, options);
  expect(result.report.packageReady).toBe(true);
  expect(result.dataset.contents.filter((content) => content.kind === 'place')).toHaveLength(3);
  expect(result.dataset.plans[0].items).toHaveLength(1);
  expect(result.dataset.records).toEqual([]);
  const guide = result.dataset.contents.find(
    (content) => content.kind === 'guide' && content.entityId === 'guide-fiction-extra',
  );
  if (guide?.kind !== 'guide') {
    throw new Error('추가 본문 누락');
  }
  const deep = guide.payload.sections.find((section) => section.key === 'deep')!;
  expect(deep.bodyMd).toContain('<Fictional Exhibition>');
  expect(deep.bodyMd).toContain('(원천 재확인)');
  expect(deep.factRefs).toHaveLength(1);
  expect(guide.payload.factBindings.find((binding) => binding.token === 'fiction-only.hours')?.ref.entityId).toBe(
    deep.factRefs[0],
  );
  expect(guide.payload.sections.find((section) => section.key === 'why_go')?.bodyMd).toBe('');
  const bodyless = result.dataset.contents.find(
    (content) => content.kind === 'guide' && content.entityId === 'guide-fiction-only',
  );
  expect(bodyless?.kind === 'guide' && bodyless.payload.sections[0].bodyMd).toContain('독립 본문 파일이 없습니다');
  await expect(normalizeSpfrPilot(fixture.extract, { ...options, bodylessPlaceIds: [] })).rejects.toThrow(
    'frontmatter',
  );
  facts.places['fiction-only'] = { region: 'other', displayName: '가상 다른 지역', facts: {} };
  await expect(normalizeSpfrPilot(fixture.extract, options)).rejects.toThrow('명시 지역');
});

it('원천 실행 상태 필드가 없으면 빈 목록으로 보존하고 잘못된 null은 거부한다', async () => {
  const fixture = await spfrPilotFixture();
  const day = fixture.extract.entries.find((entry) => entry.sourceKey === 'data/daily-cards/day-28.json')!.rawValue as {
    stops: Record<string, unknown>[];
  };
  delete day.stops[0].executionStatuses;
  const result = await normalizeSpfrPilot(fixture.extract, fixture.options);
  expect(result.dataset.plans[0].items[0].executionMarkers).toEqual([]);
  day.stops[0].executionStatuses = null;
  await expect(normalizeSpfrPilot(fixture.extract, fixture.options)).rejects.toThrow();
});

it('명부의 명시 지역과 ID를 사용하고 중복 ID는 거부한다', () => {
  const markdown = '## fiction (01)\n| `fiction-place` | 가상 이름 | spot | 선택 | — | — | — | — |\n';
  expect(spfrRegistryRows(markdown).get('fiction-place')?.regionId).toBe('fiction');
  expect(() => spfrRegistryRows(markdown + markdown)).toThrow('중복 장소');
});
