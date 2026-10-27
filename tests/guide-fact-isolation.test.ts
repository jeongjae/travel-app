import { afterEach, describe, expect, it } from 'vitest';
import { ContentRepository, TravelDB } from '../src/repository';
import { canonicalJson, digestBytes, type ContentRevision, type RevisionRef } from '../src/contracts/v2';
import { currentMappings } from '../src/transfer/normalize';
import { fixtureAssets, pilotTrip } from './fixtures/pilot';
import { factIsolation, factIsolationTrip } from './fixtures/guide-fact-isolation';

type Guide = Extract<ContentRevision, { kind: 'guide' }>;
type Fact = Extract<ContentRevision, { kind: 'fact' }>;

const databases: TravelDB[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close();
    await database.delete();
  }
});

async function openRepository(name = `fact-isolation-${crypto.randomUUID()}`) {
  const database = new TravelDB(name);
  databases.push(database);
  const repository = new ContentRepository(database);
  await repository.init();
  return { database, repository, name };
}

function envelope(tripId: string, kind: string, payload: unknown, expectedDomainRevision?: number) {
  return {
    format: 'travel-app-command',
    commandVersion: 2,
    normalizationVersion: 'fact-isolation-v1',
    tripId,
    requestId: crypto.randomUUID(),
    kind,
    payload,
    ...(expectedDomainRevision === undefined ? {} : { expectedDomainRevision }),
  };
}

async function importTrip(repository: ContentRepository, trip: Awaited<ReturnType<typeof pilotTrip>>) {
  const assets = new Map<string, Uint8Array>();
  for (const bytes of Object.values(fixtureAssets)) {
    assets.set(await digestBytes(bytes), bytes);
  }
  const provenance = {
    packageId: `package-${trip.header.tripId}`,
    packageDigest: await digestBytes(new TextEncoder().encode(canonicalJson(trip))),
    lineageId: `lineage-${trip.header.tripId}`,
    adapterVersion: '1',
    manifest: {},
    report: {},
    mappings: currentMappings(trip),
  };
  await repository.prepareImport(trip, assets, provenance);
  await repository.execute(
    envelope(trip.header.tripId, 'ImportNewTrip', {
      packageId: provenance.packageId,
      packageDigest: provenance.packageDigest,
    }),
  );
}

async function guideOf(repository: ContentRepository, tripId: string, guideId: string, context?: RevisionRef[]) {
  const pinned = context?.find((ref) => ref.targetKind === 'guide' && ref.entityId === guideId)?.revisionId;
  const guide = await repository.content(tripId, 'guide', guideId, pinned);
  if (guide?.kind !== 'guide') {
    throw new Error(`가이드 누락: ${guideId}`);
  }
  return guide as Guide;
}

/** Same lookup rule as GuideMarkdown: a binding's Fact is read at the plan-context revision, else at the head. */
async function factsShownBy(repository: ContentRepository, tripId: string, guide: Guide, context?: RevisionRef[]) {
  const shown = new Map<string, Fact>();
  for (const binding of guide.payload.factBindings) {
    const pinned = context?.find(
      (ref) => ref.targetKind === 'fact' && ref.entityId === binding.ref.entityId,
    )?.revisionId;
    const fact = await repository.content(tripId, 'fact', binding.ref.entityId, pinned);
    if (fact?.kind !== 'fact') {
      throw new Error(`Fact 누락: ${binding.ref.entityId}`);
    }
    shown.set(binding.token, fact as Fact);
  }
  return shown;
}

async function updateFact(repository: ContentRepository, tripId: string, factId: string, valueText: string) {
  const current = await repository.content(tripId, 'fact', factId);
  if (current?.kind !== 'fact') {
    throw new Error(`Fact 누락: ${factId}`);
  }
  const { commitSeq: _commitSeq, recordedAt: _recordedAt, actor: _actor, ...input } = current;
  const domainRevision = (await repository.get(tripId)).header.domainRevision;
  const next = {
    ...input,
    revisionId: `${current.revisionId}-next`,
    previousRevisionId: current.revisionId,
    payload: { ...current.payload, valueText, appReviewStatus: 'needs-review' as const },
  };
  await repository.execute(
    envelope(tripId, 'UpdateContent', { expectedRevisionId: current.revisionId, content: next }, domainRevision),
  );
  return next.revisionId;
}

describe('T-01c · 같은 revision 값의 다른 가이드와 Fact', () => {
  it('두 가이드는 같은 r1·같은 토큰을 쓰지만 처음부터 자기 Fact 값과 확인 상태를 가진다', async () => {
    const { repository } = await openRepository();
    const trip = await factIsolationTrip();
    await importTrip(repository, trip);
    const tripId = trip.header.tripId;
    const guideA = await guideOf(repository, tripId, factIsolation.guideA.guideId);
    const guideB = await guideOf(repository, tripId, factIsolation.guideB.guideId);
    // 충돌 전제: 서로 다른 가이드가 같은 revision 문자열과 같은 본문 토큰을 쓴다.
    expect(guideA.revisionId).toBe('r1');
    expect(guideB.revisionId).toBe('r1');
    expect(guideA.payload.factBindings.map((binding) => binding.token)).toEqual([factIsolation.token]);
    expect(guideB.payload.factBindings.map((binding) => binding.token)).toEqual([factIsolation.token]);
    expect(guideA.payload.sections.at(-1)?.bodyMd).toBe(guideB.payload.sections.at(-1)?.bodyMd);

    const shownA = (await factsShownBy(repository, tripId, guideA)).get(factIsolation.token)!;
    const shownB = (await factsShownBy(repository, tripId, guideB)).get(factIsolation.token)!;
    expect(shownA.entityId).toBe(factIsolation.guideA.factId);
    expect(shownB.entityId).toBe(factIsolation.guideB.factId);
    expect(shownA.revisionId).toBe(shownB.revisionId);
    expect(shownA.payload).toMatchObject({ valueText: factIsolation.valueA, appReviewStatus: 'unverified' });
    expect(shownB.payload).toMatchObject({ valueText: factIsolation.valueB, appReviewStatus: 'verified' });
  });

  it('A의 Fact만 새 revision으로 바꾸면 A는 갱신되고 B와 계획·실제 기록·B 헤드는 그대로다', async () => {
    const { repository } = await openRepository();
    const trip = await factIsolationTrip();
    await importTrip(repository, trip);
    const tripId = trip.header.tripId;
    const before = await repository.get(tripId);
    const headOf = (dataset: typeof before, kind: string, id: string) =>
      dataset.heads.find((head) => head.targetKind === kind && head.entityId === id);
    const guideBBefore = await guideOf(repository, tripId, factIsolation.guideB.guideId);
    const shownBBefore = (await factsShownBy(repository, tripId, guideBBefore)).get(factIsolation.token)!;

    const newRevision = await updateFact(repository, tripId, factIsolation.guideA.factId, factIsolation.valueAUpdated);

    const after = await repository.get(tripId);
    expect(headOf(after, 'fact', factIsolation.guideA.factId)?.revisionId).toBe(newRevision);
    const guideA = await guideOf(repository, tripId, factIsolation.guideA.guideId);
    const shownA = (await factsShownBy(repository, tripId, guideA)).get(factIsolation.token)!;
    expect(shownA.payload).toMatchObject({ valueText: factIsolation.valueAUpdated, appReviewStatus: 'needs-review' });
    expect(shownA.revisionId).toBe(newRevision);

    const guideB = await guideOf(repository, tripId, factIsolation.guideB.guideId);
    const shownB = (await factsShownBy(repository, tripId, guideB)).get(factIsolation.token)!;
    expect(shownB).toEqual(shownBBefore);
    expect(headOf(after, 'fact', factIsolation.guideB.factId)).toEqual(
      headOf(before, 'fact', factIsolation.guideB.factId),
    );
    expect(headOf(after, 'guide', factIsolation.guideB.guideId)).toEqual(
      headOf(before, 'guide', factIsolation.guideB.guideId),
    );
    expect(headOf(after, 'guide', factIsolation.guideA.guideId)).toEqual(
      headOf(before, 'guide', factIsolation.guideA.guideId),
    );
    expect(after.plans).toEqual(before.plans);
    expect(after.records).toEqual(before.records);
  });

  it('과거 계획의 고정 context는 이전 Fact를 계속 읽고 현재 기준은 새 값을 읽는다', async () => {
    const { repository } = await openRepository();
    const trip = await factIsolationTrip();
    await importTrip(repository, trip);
    const tripId = trip.header.tripId;
    const planBefore = await repository.plan(tripId, trip.plans[0].planVersionId);
    await updateFact(repository, tripId, factIsolation.guideA.factId, factIsolation.valueAUpdated);

    const guideA = await guideOf(repository, tripId, factIsolation.guideA.guideId, planBefore.contextRefs);
    const pinned = (await factsShownBy(repository, tripId, guideA, planBefore.contextRefs)).get(factIsolation.token)!;
    expect(pinned.revisionId).toBe('r1');
    expect(pinned.payload.valueText).toBe(factIsolation.valueA);
    const current = (await factsShownBy(repository, tripId, guideA)).get(factIsolation.token)!;
    expect(current.payload.valueText).toBe(factIsolation.valueAUpdated);
    // 고정 context 자체는 저장 뒤에도 바뀌지 않는다.
    expect((await repository.plan(tripId, trip.plans[0].planVersionId)).contextRefs).toEqual(planBefore.contextRefs);
  });

  it('다른 여행이 같은 가이드·Fact ID와 r1·토큰을 써도 값과 revision이 섞이지 않는다', async () => {
    const { repository } = await openRepository();
    const tripA = await factIsolationTrip();
    const tripOther = await pilotTrip(true);
    await importTrip(repository, tripA);
    await importTrip(repository, tripOther);
    const idA = tripA.header.tripId;
    const idOther = tripOther.header.tripId;
    // 충돌 전제: 두 여행의 가이드·Fact 엔터티 ID, revision, 토큰이 같다.
    expect(idA).not.toBe(idOther);
    const guideOther = await guideOf(repository, idOther, factIsolation.guideA.guideId);
    expect(guideOther.revisionId).toBe('r1');
    expect(guideOther.payload.factBindings[0].token).toBe(factIsolation.token);

    const otherBefore = await repository.get(idOther);
    await updateFact(repository, idA, factIsolation.guideA.factId, factIsolation.valueAUpdated);
    const shownOther = (await factsShownBy(repository, idOther, guideOther)).get(factIsolation.token)!;
    expect(shownOther.revisionId).toBe('r1');
    expect(shownOther.payload.valueText).toBe(factIsolation.otherTripValue);
    expect(await repository.get(idOther)).toEqual(otherBefore);

    // 반대로 다른 여행을 바꿔도 A의 값은 그대로다.
    await updateFact(repository, idOther, factIsolation.guideA.factId, '다른 여행 개정 값');
    const guideA = await guideOf(repository, idA, factIsolation.guideA.guideId);
    const shownA = (await factsShownBy(repository, idA, guideA)).get(factIsolation.token)!;
    expect(shownA.payload.valueText).toBe(factIsolation.valueAUpdated);
  });

  it('저장소를 다시 열어도 A와 B의 결과가 같고 오래된 revision으로의 덮어쓰기는 거부된다', async () => {
    const { repository, name } = await openRepository();
    const trip = await factIsolationTrip();
    await importTrip(repository, trip);
    const tripId = trip.header.tripId;
    await updateFact(repository, tripId, factIsolation.guideA.factId, factIsolation.valueAUpdated);

    const reopenedDatabase = new TravelDB(name);
    databases.push(reopenedDatabase);
    const reopened = new ContentRepository(reopenedDatabase);
    await reopened.init();
    const read = async (guideId: string) => {
      const guide = await guideOf(reopened, tripId, guideId);
      return (await factsShownBy(reopened, tripId, guide)).get(factIsolation.token)!.payload.valueText;
    };
    // A -> B -> A 순으로 읽어도 매번 같은 값이다.
    expect(await read(factIsolation.guideA.guideId)).toBe(factIsolation.valueAUpdated);
    expect(await read(factIsolation.guideB.guideId)).toBe(factIsolation.valueB);
    expect(await read(factIsolation.guideA.guideId)).toBe(factIsolation.valueAUpdated);

    // 이미 r1을 대체한 뒤 r1을 기준으로 다시 쓰려는 오래된 요청은 거부되고 A의 값은 유지된다.
    const stale = await reopened.content(tripId, 'fact', factIsolation.guideA.factId, 'r1');
    if (stale?.kind !== 'fact') {
      throw new Error('r1 Fact 누락');
    }
    const { commitSeq: _commitSeq, recordedAt: _recordedAt, actor: _actor, ...input } = stale;
    const domainRevision = (await reopened.get(tripId)).header.domainRevision;
    await expect(
      reopened.execute(
        envelope(
          tripId,
          'UpdateContent',
          {
            expectedRevisionId: 'r1',
            content: {
              ...input,
              revisionId: 'r1-stale',
              previousRevisionId: 'r1',
              payload: { ...stale.payload, valueText: '오래된 기준의 덮어쓰기' },
            },
          },
          domainRevision,
        ),
      ),
    ).rejects.toThrow('CONFLICT');
    expect(await read(factIsolation.guideA.guideId)).toBe(factIsolation.valueAUpdated);
  });
});
