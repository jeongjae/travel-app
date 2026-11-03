import { afterEach, describe, expect, it } from 'vitest';
import { ContentRepository, TravelDB } from '../src/repository';
import { command } from '../src/content/ui';
import { buildPackage, readPackage } from '../src/transfer/package';
import { currentMappings } from '../src/transfer/normalize';
import type { Review } from '../src/transfer/reimport';
import { normalizeSpfrPilot } from '../src/transfer/spfr-pilot';
import { spfrPilotAdapterVersion, spfrPilotNormalizationVersion } from '../src/transfer/spfr-stays';
import { spfrReturnTripFixture } from './fixtures/spfr-return-trip';

/**
 * C-09(REG-02): 날짜 사진은 원천 이미지의 usage가 아니라 그날 방문 장소를 따른다. 가상 fixture만 사용한다.
 */
async function convert(usage: string[]) {
  const fixture = await spfrReturnTripFixture('unknown');
  const extract = structuredClone(fixture.extract);
  const manifestEntry = extract.entries.find((entry) => entry.sourceKey === 'data/images/image-manifest.json')!;
  const manifest = manifestEntry.rawValue as { images: { usage: string[] }[] };
  manifest.images[0].usage = usage;
  // 원천 매니페스트 바이트가 바뀌었으므로 extract manifest의 해시도 맞춘다.
  const { canonicalJson, digestBytes, sourceExtractSchema } = await import('../src/contracts/v2');
  const encoded = new TextEncoder().encode(canonicalJson(manifestEntry.rawValue));
  const row = extract.manifest.find((item) => item.path === 'data/images/image-manifest.json')!;
  row.byteLength = encoded.length;
  row.sha256 = await digestBytes(encoded);
  const result = await normalizeSpfrPilot(sourceExtractSchema.parse(extract), fixture.options);
  expect(result.report.blocking).toEqual([]);
  return result.dataset.plans[0];
}

describe('C-09 · 날짜 사진은 방문 장소 순서를 따른다', () => {
  it('usage가 다른 날을 가리켜도 무시하고 방문 장소의 사진을 넣는다', async () => {
    const plan = await convert(['daily/day-31.html']);
    const photoCount = Object.fromEntries(plan.days.map((day) => [day.dayId, day.assetRefs.length]));
    // day-28·29·30은 fiction-place를 방문한다. day-31(귀국일)은 방문 장소가 없으므로 usage가 있어도 비어 있다.
    expect(photoCount).toEqual({ 'day-28': 1, 'day-29': 1, 'day-30': 1, 'day-31': 0 });
  });

  it('같은 장소는 한 번만 넣고 캡션은 장소 이름으로 시작한다', async () => {
    const plan = await convert([]);
    const day30 = plan.days.find((day) => day.dayId === 'day-30')!;
    expect(day30.assetRefs).toHaveLength(1);
    expect(day30.assetRefs[0].caption?.startsWith('가상 장소 · 가상 저작자')).toBe(true);
  });

  it('변환기 버전이 올라가 새 패키지를 구분한다', () => {
    expect(spfrPilotAdapterVersion).toBe('spfr-pilot-v4');
    expect(spfrPilotNormalizationVersion).toBe('4');
  });
});

const databases: TravelDB[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close();
    await database.delete();
  }
});

describe('C-09 · 재가져오기 의미', () => {
  it('이전 규칙으로 가져온 여행에 새 패키지를 재가져오면 날짜 사진 차이가 source-only로 나오고 적용 전에는 바뀌지 않는다', async () => {
    const fixture = await spfrReturnTripFixture('unknown');
    const result = await normalizeSpfrPilot(fixture.extract, fixture.options);
    const assets = new Map([
      ...fixture.options.media.map((file) => [file.sha256, file.bytes] as const),
      ...result.generatedAssets,
    ]);
    const newer = structuredClone(result.dataset);
    const older = structuredClone(result.dataset);
    // 이전 규칙: usage가 가리킨 틀린 날짜(day-31)에 사진이 있고 방문일(day-29)에는 없다.
    const wrongPhoto = newer.plans[0].days.find((day) => day.dayId === 'day-29')!.assetRefs;
    for (const day of older.plans[0].days) {
      day.assetRefs = day.dayId === 'day-31' ? structuredClone(wrongPhoto) : [];
    }
    async function pack(dataset: typeof newer, sourceCommit: string, adapter: string, normalization: string) {
      dataset.plans[0].items.sort((a, b) => a.order - b.order);
      const packaged = await buildPackage(
        dataset,
        assets,
        {
          sourceRepository: 'fiction/source',
          sourceCommit,
          lineageId: 'fiction-day-photo',
          adapterVersion: adapter,
          normalizationVersion: normalization,
        },
        result.report,
        currentMappings(dataset),
      );
      return readPackage(packaged.blob);
    }
    const olderPackage = await pack(older, 'a'.repeat(40), 'spfr-pilot-v3', '3');
    const newerPackage = await pack(newer, 'b'.repeat(40), spfrPilotAdapterVersion, spfrPilotNormalizationVersion);
    const tripId = newer.header.tripId;

    const database = new TravelDB(`c09-${crypto.randomUUID()}`);
    databases.push(database);
    const repository = new ContentRepository(database);
    await repository.init();
    await repository.prepareImport(olderPackage.dataset, olderPackage.assets, olderPackage.provenance);
    await repository.execute(
      command(tripId, 'ImportNewTrip', {
        packageId: olderPackage.provenance.packageId,
        packageDigest: olderPackage.provenance.packageDigest,
      }),
    );
    const before = await repository.get(tripId);

    const jobId = await repository.prepareImport(newerPackage.dataset, newerPackage.assets, newerPackage.provenance);
    const target: Review = await repository.reviewReimport(jobId);
    expect(target.units.find((unit) => unit.targetKind === 'plan')?.status).toBe('source-only');
    expect(await repository.get(tripId)).toEqual(before);

    const choices = Object.fromEntries(target.units.map((unit) => [unit.key, unit.recommendation]));
    const reviewDigest = await repository.prepareReimportDecision(target, choices);
    await repository.execute(
      command(
        tripId,
        'ApplyReimport',
        {
          packageId: target.packageId,
          packageDigest: target.packageDigest,
          lineageId: target.lineageId,
          reviewDigest,
        },
        target.baseDomainRevision,
      ),
    );
    const after = await repository.get(tripId);
    const latest = Object.fromEntries(after.plans[1].days.map((day) => [day.dayId, day.assetRefs.length]));
    expect(latest['day-29']).toBe(1);
    expect(latest['day-31']).toBe(0);
    expect(after.plans[0]).toEqual(before.plans[0]);
  });
});
