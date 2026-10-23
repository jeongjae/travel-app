import { expect, it } from 'vitest';
import { canonicalJson } from '../src/contracts/v2';
import { normalizeSpfrPilot } from '../src/transfer/spfr-pilot';
import { buildPackage, readPackage } from '../src/transfer/package';
import { reviewWorkspace, workspaceUrl } from '../src/storage/workspace-name';
import { spfrPilotFixture } from './fixtures/spfr-pilot';

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

it('새 미대응 입력·표본 안 현장 상태는 완료를 차단하고 첨부 변조·빈 수식 캐시를 거부한다', async () => {
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
  const blocked = await normalizeSpfrPilot(state, fixture.options);
  expect(blocked.report.blocking.some((reason) => reason.startsWith('FIELD_STATE_ADAPTER_REQUIRED:'))).toBe(true);
  expect(blocked.dataset.records).toEqual([]);
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
