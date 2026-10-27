import { buildPackage, readPackage } from '../../src/transfer/package';
import { canonicalJson, digestBytes, type TripDataset } from '../../src/contracts/v2';
import { currentMappings } from '../../src/transfer/normalize';
import { normalizeSpfrPilot } from '../../src/transfer/spfr-pilot';
import { fixtureAssets } from './pilot';
import { factIsolation, factIsolationTrip, factIsolationUpdatedTrip } from './guide-fact-isolation';
import { spfrReturnTripFixture, type ReturnDayRegions } from './spfr-return-trip';

/**
 * Human-review packages built from the SAME fixture functions the regression tests call
 * (spfrReturnTripFixture, factIsolationTrip, factIsolationUpdatedTrip). Nothing here is real travel data.
 * The only difference from the tested normalization output is the trip name, so that two variants can be
 * opened side by side in one empty review profile.
 */
export type ReviewPackage = {
  fileName: string;
  tripId: string;
  tripName: string;
  lineageId: string;
  role: string;
  fixtureFunction: string;
  blob: Blob;
  datasetSha256: string;
};

const returnTrips: { variant: ReturnDayRegions; tripId: string; tripName: string; note: string }[] = [
  {
    variant: 'unknown',
    tripId: 'fiction-return-unknown',
    tripName: '가상 귀국·이동 여행 (귀국일 장소 지역 미상)',
    note: '귀국일의 두 활동에 장소 참조가 없다.',
  },
  {
    variant: 'explicit',
    tripId: 'fiction-return-explicit',
    tripName: '가상 귀국·이동 여행 (귀국일 장소 지역 명시)',
    note: '귀국일의 두 번째 활동이 원천에 지역이 명시된 장소(가상 다른 장소)를 가리킨다.',
  },
];

async function pack(dataset: TripDataset, lineageId: string, sourceCommit: string) {
  const assets = new Map<string, Uint8Array>();
  for (const bytes of Object.values(fixtureAssets)) {
    assets.set(await digestBytes(bytes), bytes);
  }
  return { assets, sourceCommit, lineageId, dataset };
}

async function toBlob(
  dataset: TripDataset,
  assets: Map<string, Uint8Array>,
  lineageId: string,
  sourceCommit: string,
  report?: Awaited<ReturnType<typeof normalizeSpfrPilot>>['report'],
  mappings?: Awaited<ReturnType<typeof normalizeSpfrPilot>>['mappings'],
) {
  const packaged = await buildPackage(
    dataset,
    assets,
    {
      sourceRepository: 'fiction/review',
      sourceCommit,
      lineageId,
      adapterVersion: report?.adapterVersion ?? '1',
      normalizationVersion: report ? '2' : '1',
    },
    report,
    mappings,
  );
  // The package must survive its own reader before a person is asked to open it.
  await readPackage(packaged.blob);
  return packaged.blob;
}

export async function buildReviewPackages(): Promise<ReviewPackage[]> {
  const packages: ReviewPackage[] = [];
  for (const trip of returnTrips) {
    const fixture = await spfrReturnTripFixture(trip.variant);
    const result = await normalizeSpfrPilot(fixture.extract, { ...fixture.options, tripId: trip.tripId });
    if (result.report.blocking.length) {
      throw new Error(`정규화 차단 항목: ${result.report.blocking.join(', ')}`);
    }
    // The import baseline includes trip metadata, so the correspondence table is rebuilt after the rename.
    result.dataset.header.name = trip.tripName;
    const mappings = currentMappings(result.dataset);
    const assets = new Map<string, Uint8Array>([
      ...fixture.options.media.map((file) => [file.sha256, file.bytes] as const),
      ...result.generatedAssets,
    ]);
    const lineageId = trip.tripId;
    packages.push({
      fileName: `${trip.tripId}.zip`,
      tripId: trip.tripId,
      tripName: trip.tripName,
      lineageId,
      role: `귀국일·이동일 화면 확인. ${trip.note}`,
      fixtureFunction: `spfrReturnTripFixture('${trip.variant}') → normalizeSpfrPilot(days 28–31)`,
      blob: await toBlob(result.dataset, assets, lineageId, 'synthetic-v1', result.report, mappings),
      datasetSha256: await digestBytes(new TextEncoder().encode(canonicalJson(result.dataset))),
    });
  }
  const base = await pack(await factIsolationTrip(), 'fiction-fact-isolation', 'synthetic-v1');
  const updated = await pack(await factIsolationUpdatedTrip(), 'fiction-fact-isolation', 'synthetic-v2');
  for (const [item, fileName, role, fixtureFunction] of [
    [base, 'fact-isolation-v1.zip', 'Fact 격리 화면의 시작 패키지.', 'factIsolationTrip()'],
    [
      updated,
      'fact-isolation-v2-update.zip',
      '같은 여행 재가져오기용. 가이드 A의 Fact만 새 값(재가져오기 차이 검토에서 적용).',
      'factIsolationUpdatedTrip()',
    ],
  ] as const) {
    packages.push({
      fileName,
      tripId: item.dataset.header.tripId,
      tripName: factIsolation.tripName,
      lineageId: item.lineageId,
      role,
      fixtureFunction,
      blob: await toBlob(item.dataset, item.assets, item.lineageId, item.sourceCommit),
      datasetSha256: await digestBytes(new TextEncoder().encode(canonicalJson(item.dataset))),
    });
  }
  return packages;
}
