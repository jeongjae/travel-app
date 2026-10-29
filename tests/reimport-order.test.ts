import { afterEach, describe, expect, it } from 'vitest';
import { ContentRepository, TravelDB } from '../src/repository';
import { command } from '../src/content/ui';
import { buildPackage, readPackage } from '../src/transfer/package';
import { currentMappings } from '../src/transfer/normalize';
import { normalizeSpfrPilot } from '../src/transfer/spfr-pilot';
import { comparablePlan } from '../src/transfer/comparable';
import { spfrReturnTripFixture } from './fixtures/spfr-return-trip';

/**
 * T-05(F-4): 같은 패키지를 다시 가져올 때 저장/조회 배열 순서만으로 계획 차이가 생기면 안 된다.
 * 가상 fixture만 사용한다. 패키지 항목은 일부러 날짜별 order가 반복되고 저장 순서와 다르게 둔다.
 */
const databases: TravelDB[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close();
    await database.delete();
  }
});

async function build() {
  const fixture = await spfrReturnTripFixture('unknown');
  const result = await normalizeSpfrPilot(fixture.extract, fixture.options);
  expect(result.report.blocking).toEqual([]);
  const assets = new Map([
    ...fixture.options.media.map((file) => [file.sha256, file.bytes] as const),
    ...result.generatedAssets,
  ]);
  const dataset = structuredClone(result.dataset);
  const plan = dataset.plans[0];
  // 가상 계획 전제: 여러 날짜가 같은 order 값을 쓰고, 패키지 배열은 날짜 순서와 다르게(뒤집어) 둔다.
  const orders = new Set(plan.items.map((item) => item.order));
  expect(orders.size).toBeLessThan(plan.items.length);
  plan.items.reverse();
  plan.legs.reverse();
  plan.stays.reverse();
  const packaged = await buildPackage(
    dataset,
    assets,
    {
      sourceRepository: 'fiction/source',
      sourceCommit: 'a'.repeat(40),
      lineageId: 'fiction-order',
      adapterVersion: 'spfr-pilot-v3',
      normalizationVersion: '3',
    },
    result.report,
    currentMappings(dataset),
  );
  return { pkg: await readPackage(packaged.blob), tripId: dataset.header.tripId };
}

async function importOnce() {
  const { pkg, tripId } = await build();
  const database = new TravelDB(`order-${crypto.randomUUID()}`);
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
  return { repository, pkg, tripId };
}

describe('재가져오기 항목 순서 · F-4', () => {
  it('같은 패키지를 다시 검토해도 계획 단위는 같은 것으로 나온다', async () => {
    const { repository, pkg } = await importOnce();
    const jobId = await repository.prepareImport(pkg.dataset, pkg.assets, pkg.provenance);
    const review = await repository.reviewReimport(jobId);
    // 차이가 없으면 검토 단위 자체가 만들어지지 않는다.
    expect(review.units.filter((unit) => unit.targetKind === 'plan')).toEqual([]);
  });

  it('같은 의미의 계획은 배열 순서와 무관하게 같은 비교 표현을 만든다', async () => {
    const { repository, pkg, tripId } = await importOnce();
    const stored = await repository.get(tripId);
    const packaged = pkg.dataset.plans[0];
    expect(comparablePlan(stored.plans[0])).toEqual(comparablePlan(packaged));
  });

  it('실제 순서·시간·날짜 이동은 여전히 다른 표현이 된다', async () => {
    const { pkg } = await importOnce();
    const base = pkg.dataset.plans[0];
    const baseline = JSON.stringify(comparablePlan(base));
    const changes: Array<(plan: typeof base) => void> = [
      (plan) => {
        plan.items[0].order += 100;
      },
      (plan) => {
        plan.items[0].title = `${plan.items[0].title} 수정`;
      },
      (plan) => {
        plan.items[0].dayId = plan.items.find((item) => item.dayId !== plan.items[0].dayId)!.dayId;
      },
      (plan) => {
        plan.days[0].regionIds = [...plan.days[0].regionIds, 'zzz'];
      },
    ];
    for (const change of changes) {
      const copy = structuredClone(base);
      change(copy);
      expect(JSON.stringify(comparablePlan(copy))).not.toBe(baseline);
    }
  });
});
