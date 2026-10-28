import { afterEach, describe, expect, it } from 'vitest';
import { ContentRepository, TravelDB } from '../src/repository';
import { command } from '../src/content/ui';
import { buildPackage, readPackage } from '../src/transfer/package';
import { currentMappings } from '../src/transfer/normalize';
import { normalizeSpfrPilot } from '../src/transfer/spfr-pilot';
import { spfrReturnTripFixture } from './fixtures/spfr-return-trip';
import type { Choice, Review } from '../src/transfer/reimport';

/**
 * REG-01(T-04) 호환: 이전 의미(이동일 출발 지역·숙박 종료일 지역 없음)로 가져온 여행에
 * 새 의미의 패키지를 다시 가져오면 사용자 확인을 거치는 계획 차이로만 나타난다. 가상 fixture만 사용한다.
 */
const databases: TravelDB[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close();
    await database.delete();
  }
});

async function builds() {
  const fixture = await spfrReturnTripFixture('unknown');
  const result = await normalizeSpfrPilot(fixture.extract, fixture.options);
  expect(result.report.blocking).toEqual([]);
  const assets = new Map([
    ...fixture.options.media.map((file) => [file.sha256, file.bytes] as const),
    ...result.generatedAssets,
  ]);
  const newer = structuredClone(result.dataset);
  const older = structuredClone(result.dataset);
  // 이전 변환 의미: 이동일은 도착 지역만, 숙박 종료일은 비어 있다.
  for (const day of older.plans[0].days) {
    if (day.dayId === 'day-30') {
      day.regionIds = ['other'];
    }
    if (day.dayId === 'day-31') {
      day.regionIds = [];
    }
  }
  async function pack(dataset: typeof newer, sourceCommit: string) {
    // ContentRepository.get() returns plan items sorted by `order` only, and plan comparison is order-sensitive.
    // Package the items in that stored order so the baseline matches the stored plan (see T-04 result, finding 1).
    dataset.plans[0].items.sort((a, b) => a.order - b.order);
    const packaged = await buildPackage(
      dataset,
      assets,
      {
        sourceRepository: 'fiction/source',
        sourceCommit,
        lineageId: 'fiction-return',
        adapterVersion: sourceCommit === 'a'.repeat(40) ? 'spfr-pilot-v2' : 'spfr-pilot-v3',
        normalizationVersion: sourceCommit === 'a'.repeat(40) ? '2' : '3',
      },
      result.report,
      currentMappings(dataset),
    );
    return readPackage(packaged.blob);
  }
  return {
    older: await pack(older, 'a'.repeat(40)),
    newer: await pack(newer, 'b'.repeat(40)),
    tripId: newer.header.tripId,
  };
}

async function importFirst() {
  const { older, newer, tripId } = await builds();
  const database = new TravelDB(`reg01-${crypto.randomUUID()}`);
  databases.push(database);
  const repository = new ContentRepository(database);
  await repository.init();
  await repository.prepareImport(older.dataset, older.assets, older.provenance);
  await repository.execute(
    command(tripId, 'ImportNewTrip', {
      packageId: older.provenance.packageId,
      packageDigest: older.provenance.packageDigest,
    }),
  );
  return { repository, newer, tripId };
}

async function review(repository: ContentRepository, newer: Awaited<ReturnType<typeof builds>>['newer']) {
  const jobId = await repository.prepareImport(newer.dataset, newer.assets, newer.provenance);
  return repository.reviewReimport(jobId);
}

async function applyReview(
  repository: ContentRepository,
  target: Review,
  choose?: (unit: Review['units'][number]) => Choice,
) {
  const choices = Object.fromEntries(
    target.units.map((unit) => [unit.key, choose ? choose(unit) : unit.recommendation]),
  );
  const reviewDigest = await repository.prepareReimportDecision(target, choices);
  return repository.execute(
    command(
      target.tripId,
      'ApplyReimport',
      { packageId: target.packageId, packageDigest: target.packageDigest, lineageId: target.lineageId, reviewDigest },
      target.baseDomainRevision,
    ),
  );
}

describe('REG-01 호환 · 구 의미 가져오기 뒤 새 패키지 재가져오기', () => {
  it('구 패키지도 그대로 읽히고 가져와지며 기존 계획은 자동으로 바뀌지 않는다', async () => {
    const { repository, tripId } = await importFirst();
    const trip = await repository.get(tripId);
    const days = Object.fromEntries(trip.plans[0].days.map((day) => [day.dayId, day.regionIds]));
    expect(days['day-30']).toEqual(['other']);
    expect(days['day-31']).toEqual([]);
  });

  it('사용자 편집이 없으면 계획 차이는 검토 단위로만 나오고 적용 전에는 저장값이 그대로다', async () => {
    const { repository, newer, tripId } = await importFirst();
    const before = await repository.get(tripId);
    const target = await review(repository, newer);
    const planUnit = target.units.find((unit) => unit.targetKind === 'plan');
    expect(planUnit?.status).toBe('source-only');
    expect(await repository.get(tripId)).toEqual(before);
    await applyReview(repository, target);
    const after = await repository.get(tripId);
    expect(after.plans).toHaveLength(2);
    // 과거 계획 버전은 불변이다.
    expect(after.plans[0]).toEqual(before.plans[0]);
    const latest = Object.fromEntries(after.plans[1].days.map((day) => [day.dayId, day.regionIds]));
    expect(latest['day-30']).toEqual(['fiction', 'other']);
    expect(latest['day-31']).toEqual(['other']);
  });

  it('사용자가 계획을 고쳤고 새 지역 변경도 있으면 충돌로 보류되고 현장 기록은 보존된다', async () => {
    const { repository, newer, tripId } = await importFirst();
    const trip = await repository.get(tripId);
    const activityId = trip.plans[0].items[0].activityId;
    await repository.execute(
      command(
        tripId,
        'ChangePlan',
        {
          currentPlanVersionId: trip.plans[0].planVersionId,
          operations: [{ type: 'remove-item', activityId }],
          reason: '앱에서 조정',
        },
        trip.header.domainRevision,
      ),
    );
    const edited = await repository.get(tripId);
    const target = await review(repository, newer);
    const planUnit = target.units.find((unit) => unit.targetKind === 'plan');
    expect(planUnit?.status).toBe('conflict');
    expect(planUnit?.recommendation).toBe('defer');
    await applyReview(repository, target);
    const after = await repository.get(tripId);
    expect(after.plans.map((plan) => plan.planVersionId)).toEqual(edited.plans.map((plan) => plan.planVersionId));
    expect(after.records).toEqual(edited.records);
  });
});
