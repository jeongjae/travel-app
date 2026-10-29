import { afterEach, describe, expect, it } from 'vitest';
import { ContentRepository, TravelDB } from '../src/repository';
import { command } from '../src/content/ui';
import { buildPackage, readPackage } from '../src/transfer/package';
import { currentMappings } from '../src/transfer/normalize';
import { normalizeSpfrPilot } from '../src/transfer/spfr-pilot';
import { canonicalPlanValue, comparablePlan } from '../src/transfer/comparable';
import { spfrReturnTripFixture } from './fixtures/spfr-return-trip';
import type { PlanVersion } from '../src/contracts/v2/index';

/**
 * T-05 R1: T-05 이전 비교 함수(planVersionId만 제외, 배열 순서 유지)로 만든 기준 B를 가진 패키지와
 * DB 저장 기준이 정규화 뒤에도 계속 가져와지고 재검토된다. 가상 fixture만 사용한다.
 */
const databases: TravelDB[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close();
    await database.delete();
  }
});

/** T-05 이전 comparablePlan 그대로. */
function legacyComparablePlan(plan: PlanVersion) {
  const strip = ({ planVersionId: _, ...rest }: { planVersionId: string }) => rest;
  return {
    days: plan.days.map(strip),
    items: plan.items.map(strip),
    legs: plan.legs.map(strip),
    stays: plan.stays.map(strip),
  };
}

async function legacyPackage(
  edit?: (plan: PlanVersion) => void,
  sourceCommit = 'a'.repeat(40),
  tamper?: (baseline: Record<string, unknown>) => void,
) {
  const fixture = await spfrReturnTripFixture('unknown');
  const result = await normalizeSpfrPilot(fixture.extract, fixture.options);
  const dataset = structuredClone(result.dataset);
  const plan = dataset.plans[0];
  plan.items.reverse();
  plan.legs.reverse();
  plan.stays.reverse();
  edit?.(plan);
  const mappings = currentMappings(dataset);
  const baseline = legacyComparablePlan(plan) as Record<string, unknown>;
  tamper?.(baseline);
  mappings.find((mapping) => mapping.targetKind === 'plan')!.baselineValue = baseline;
  const assets = new Map([
    ...fixture.options.media.map((file) => [file.sha256, file.bytes] as const),
    ...result.generatedAssets,
  ]);
  const built = await buildPackage(
    dataset,
    assets,
    {
      sourceRepository: 'fiction/source',
      sourceCommit,
      lineageId: 'fiction-legacy-order',
      adapterVersion: 'spfr-pilot-v2',
      normalizationVersion: '2',
    },
    result.report,
    mappings,
  );
  return { pkg: await readPackage(built.blob), tripId: dataset.header.tripId };
}

async function importLegacy() {
  const { pkg, tripId } = await legacyPackage();
  const database = new TravelDB(`legacy-${crypto.randomUUID()}`);
  databases.push(database);
  const repository = new ContentRepository(database);
  await repository.init();
  await repository.prepareImport(pkg.dataset, pkg.assets, pkg.provenance);
  await repository.execute(
    command(tripId, 'ImportNewTrip', {
      packageId: pkg.provenance.packageId,
      packageDigest: pkg.provenance.packageDigest,
    }),
  );
  return { repository, tripId };
}

async function reviewPlanUnits(repository: ContentRepository, edit?: (plan: PlanVersion) => void) {
  const { pkg } = await legacyPackage(edit, 'b'.repeat(40));
  const jobId = await repository.prepareImport(pkg.dataset, pkg.assets, pkg.provenance);
  const review = await repository.reviewReimport(jobId);
  return review.units.filter((unit) => unit.targetKind === 'plan');
}

const changeTime = (plan: PlanVersion) => {
  const other = plan.items.find((item) => JSON.stringify(item.time) !== JSON.stringify(plan.items[0].time))!;
  plan.items[0].time = structuredClone(other.time);
};

async function userRemovesFirstItem(repository: ContentRepository, tripId: string) {
  const trip = await repository.get(tripId);
  await repository.execute(
    command(
      tripId,
      'ChangePlan',
      {
        currentPlanVersionId: trip.plans[0].planVersionId,
        operations: [{ type: 'remove-item', activityId: trip.plans[0].items[0].activityId }],
        reason: '앱에서 조정',
      },
      trip.header.domainRevision,
    ),
  );
}

describe('T-05 R1 · 이전 비교 기준 호환', () => {
  it('이전 비교 함수로 만든 v2 패키지를 처음 가져올 수 있다', async () => {
    const { repository, tripId } = await importLegacy();
    expect((await repository.get(tripId)).plans).toHaveLength(1);
  });

  it('이전 기준을 저장한 DB에서 같은 패키지를 다시 검토해도 계획 차이가 없다', async () => {
    const { repository } = await importLegacy();
    expect(await reviewPlanUnits(repository)).toEqual([]);
  });

  it('새 원천만 바뀌면 source-only다', async () => {
    const { repository } = await importLegacy();
    const units = await reviewPlanUnits(repository, changeTime);
    expect(units.map((unit) => unit.status)).toEqual(['source-only']);
  });

  it('앱만 바뀌면 app-only다', async () => {
    const { repository, tripId } = await importLegacy();
    await userRemovesFirstItem(repository, tripId);
    const units = await reviewPlanUnits(repository);
    expect(units.map((unit) => unit.status)).toEqual(['app-only']);
  });

  it('양쪽이 바뀌면 conflict이고 defer를 권고한다', async () => {
    const { repository, tripId } = await importLegacy();
    await userRemovesFirstItem(repository, tripId);
    const units = await reviewPlanUnits(repository, changeTime);
    expect(units.map((unit) => [unit.status, unit.recommendation])).toEqual([['conflict', 'defer']]);
  });

  it('정규화는 입력 배열을 바꾸지 않고, 실제 시간 필드 변경은 다른 표현이 된다', async () => {
    const { pkg } = await legacyPackage();
    const plan = pkg.dataset.plans[0];
    const before = JSON.stringify(plan);
    const baselineBefore = JSON.stringify(pkg.provenance.mappings.find((m) => m.targetKind === 'plan')!.baselineValue);
    const canonical = JSON.stringify(comparablePlan(plan));
    const changed = structuredClone(plan);
    changeTime(changed);
    expect(JSON.stringify(plan)).toBe(before);
    expect(JSON.stringify(pkg.provenance.mappings.find((m) => m.targetKind === 'plan')!.baselineValue)).toBe(
      baselineBefore,
    );
    expect(JSON.stringify(comparablePlan(changed))).not.toBe(canonical);
    expect(JSON.stringify(canonicalPlanValue(legacyComparablePlan(plan)))).toBe(canonical);
  });

  it.each([
    [
      '기준 B에 대상에 없는 최상위 필드를 더한 패키지',
      (baseline: Record<string, unknown>) => (baseline.unexpected = 'x'),
    ],
    [
      '기준 B 행에 대상에 없는 필드를 더한 패키지',
      (baseline: Record<string, unknown>) => ((baseline.items as Record<string, unknown>[])[0].unexpected = 'x'),
    ],
    [
      '기준 B의 실제 값이 대상과 다른 패키지',
      (baseline: Record<string, unknown>) => ((baseline.items as Record<string, unknown>[])[0].title = '다른 제목'),
    ],
  ])('%s는 순서가 달라도 계속 거부한다', async (_name, tamper) => {
    const { pkg } = await legacyPackage(undefined, 'a'.repeat(40), tamper);
    const database = new TravelDB(`legacy-${crypto.randomUUID()}`);
    databases.push(database);
    const repository = new ContentRepository(database);
    await repository.init();
    await expect(repository.prepareImport(pkg.dataset, pkg.assets, pkg.provenance)).rejects.toThrow(
      '기준 B가 대상 콘텐츠와 다릅니다.',
    );
  });
});
