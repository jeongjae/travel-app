import { afterEach, describe, expect, it } from 'vitest';
import { ContentRepository, TravelDB } from '../src/repository';
import { buildNewTrip } from '../src/content/trip-factory';
import type { ContentRevision, TripDataset } from '../src/contracts/v2/index';

/** C-01 T-C1: 지역·장소·본문 생성과 소유 연결은 한 저장 단위다. 가상 여행만 사용한다. */
const databases: TravelDB[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close();
    await database.delete();
  }
});

const uuid = () => crypto.randomUUID();
const envelope = (
  tripId: string,
  kind: string,
  payload: unknown,
  expectedDomainRevision?: number,
  requestId = uuid(),
) => ({
  format: 'travel-app-command',
  commandVersion: 2,
  normalizationVersion: 'c01',
  tripId,
  requestId,
  kind,
  payload,
  ...(expectedDomainRevision === undefined ? {} : { expectedDomainRevision }),
});

type Input = Record<string, unknown>;
const base = (tripId: string, kind: string, entityId: string) => ({
  tripId,
  kind,
  entityId,
  revisionId: uuid(),
  schemaVersion: 2,
  sourceRefs: [],
});
const region = (tripId: string, entityId: string, guideIds: string[] = []): Input => ({
  ...base(tripId, 'region', entityId),
  payload: { name: '가상 지역', guideIds, assetRefs: [] },
});
const place = (tripId: string, entityId: string, regionIds: string[], guideId?: string): Input => ({
  ...base(tripId, 'place', entityId),
  payload: {
    regionIds,
    name: '가상 장소',
    aliases: [],
    placeKind: 'sight',
    summary: '가상 요약',
    dontMiss: [],
    ...(guideId ? { guideId } : {}),
    assetRefs: [],
  },
});
const sections = ['why_go', 'deep', 'practical'].map((key, order) => ({
  key,
  title: key,
  order,
  bodyMd: `${key} 본문`,
  factRefs: [],
  assetRefs: [],
  linkRefs: [],
}));
const guide = (
  tripId: string,
  entityId: string,
  documentKind: 'place-guide' | 'region-guide',
  ownerKind: 'place' | 'region',
  ownerId: string,
  withSections = sections,
): Input => ({
  ...base(tripId, 'guide', entityId),
  payload: {
    documentKind,
    ownerRef: { tripId, targetKind: ownerKind, entityId: ownerId },
    title: '가상 본문',
    sections: withSections,
    factBindings: [],
    assetRefs: [],
  },
});

async function setup() {
  const db = new TravelDB(`batch-${uuid()}`);
  databases.push(db);
  const repo = new ContentRepository(db);
  await repo.init();
  return { db, repo };
}
async function newTrip(repo: ContentRepository, name = '가상 여행') {
  const trip = buildNewTrip({ name, start: '2032-05-01', end: '2032-05-03' });
  await repo.execute(envelope(trip.tripId, 'CreateTrip', { header: trip.header, initialPlan: trip.initialPlan }));
  return trip.tripId;
}
const batch = (tripId: string, expected: number, create: Input[], updateOwners: unknown[] = [], requestId = uuid()) =>
  envelope(tripId, 'CreateContentBatch', { create, updateOwners }, expected, requestId);

async function snapshot(db: TravelDB, repo: ContentRepository, tripId: string) {
  return {
    trip: await repo.get(tripId),
    receipts: await db.table('command_receipts').count(),
    meta: await repo.meta(),
  };
}
const current = (trip: TripDataset, kind: ContentRevision['kind'], entityId: string) => {
  const head = trip.heads.find((h) => h.targetKind === kind && h.entityId === entityId);
  return trip.contents.find((c) => c.kind === kind && c.entityId === entityId && c.revisionId === head?.revisionId);
};
const placeWithGuide = (tripId: string, regionId: string) => {
  const placeId = uuid();
  const guideId = uuid();
  return {
    placeId,
    guideId,
    create: [place(tripId, placeId, [regionId], guideId), guide(tripId, guideId, 'place-guide', 'place', placeId)],
  };
};

describe('CreateContentBatch · 원자 생성과 소유 연결', () => {
  it('장소와 장소 본문을 한 번에 저장하고 여행 revision을 한 번만 올린다', async () => {
    const { repo } = await setup();
    const tripId = await newTrip(repo);
    const regionId = uuid();
    const first = await repo.execute(batch(tripId, 0, [region(tripId, regionId)]));
    expect(first.domainRevision).toBe(1);
    const { placeId, guideId, create } = placeWithGuide(tripId, regionId);
    const result = await repo.execute(batch(tripId, 1, create));
    expect(result.domainRevision).toBe(2);
    const trip = await repo.get(tripId);
    expect(current(trip, 'place', placeId)).toBeTruthy();
    expect(current(trip, 'guide', guideId)).toBeTruthy();
    expect(trip.plans).toHaveLength(1);
    expect(trip.records).toEqual([]);
    expect(trip.heads.every((head) => head.status === 'active')).toBe(true);
  });

  it('기존 지역의 연결 갱신과 새 지역 가이드를 함께 저장한다', async () => {
    const { repo } = await setup();
    const tripId = await newTrip(repo);
    const regionId = uuid();
    await repo.execute(batch(tripId, 0, [region(tripId, regionId)]));
    const before = await repo.get(tripId);
    const old = current(before, 'region', regionId)!;
    const guideId = uuid();
    const updated = { ...region(tripId, regionId, [guideId]), previousRevisionId: old.revisionId };
    await repo.execute(
      batch(
        tripId,
        1,
        [guide(tripId, guideId, 'region-guide', 'region', regionId)],
        [{ expectedRevisionId: old.revisionId, content: updated }],
      ),
    );
    const after = await repo.get(tripId);
    expect(current(after, 'region', regionId)!.revisionId).not.toBe(old.revisionId);
    expect(after.contents.find((c) => c.revisionId === old.revisionId)).toEqual(old);
    expect(current(after, 'guide', guideId)).toBeTruthy();
  });

  type Context = { tripId: string; otherRegionId: string; regionId: string };
  const rejections: [string, (ctx: Context) => Input[]][] = [
    [
      '장소가 가리키지 않는 본문',
      ({ tripId, regionId }) => {
        const placeId = uuid();
        return [place(tripId, placeId, [regionId]), guide(tripId, uuid(), 'place-guide', 'place', placeId)];
      },
    ],
    ['없는 본문을 가리키는 장소', ({ tripId, regionId }) => [place(tripId, uuid(), [regionId], uuid())]],
    [
      '소유자가 다른 장소 본문',
      ({ tripId, regionId }) => {
        const placeId = uuid();
        const guideId = uuid();
        return [place(tripId, placeId, [regionId], guideId), guide(tripId, guideId, 'place-guide', 'place', uuid())];
      },
    ],
    ['다른 여행의 지역을 쓰는 장소', ({ tripId, otherRegionId }) => [place(tripId, uuid(), [otherRegionId])]],
    [
      '필수 섹션이 없는 장소 본문',
      ({ tripId, regionId }) => {
        const placeId = uuid();
        const guideId = uuid();
        return [
          place(tripId, placeId, [regionId], guideId),
          guide(tripId, guideId, 'place-guide', 'place', placeId, sections.slice(0, 2)),
        ];
      },
    ],
    ['이미 있는 콘텐츠 ID', ({ tripId, regionId }) => [region(tripId, regionId)]],
    ['이전 revision을 가진 신규 콘텐츠', ({ tripId }) => [{ ...region(tripId, uuid()), previousRevisionId: uuid() }]],
  ];
  it.each(rejections)('%s는 거부하고 저장 상태·영수증을 바꾸지 않는다', async (_name, build) => {
    const { db, repo } = await setup();
    const tripId = await newTrip(repo);
    const otherTripId = await newTrip(repo, '다른 가상 여행');
    const regionId = uuid();
    const otherRegionId = uuid();
    await repo.execute(batch(tripId, 0, [region(tripId, regionId)]));
    await repo.execute(batch(otherTripId, 0, [region(otherTripId, otherRegionId)]));
    const before = await snapshot(db, repo, tripId);
    const otherBefore = await repo.get(otherTripId);
    await expect(repo.execute(batch(tripId, 1, build({ tripId, otherRegionId, regionId })))).rejects.toThrow();
    expect(await snapshot(db, repo, tripId)).toEqual(before);
    expect(await repo.get(otherTripId)).toEqual(otherBefore);
  });

  it('오래된 여행 revision과 오래된 소유자 revision은 거부한다', async () => {
    const { db, repo } = await setup();
    const tripId = await newTrip(repo);
    const regionId = uuid();
    await repo.execute(batch(tripId, 0, [region(tripId, regionId)]));
    const before = await snapshot(db, repo, tripId);
    await expect(repo.execute(batch(tripId, 0, [region(tripId, uuid())]))).rejects.toThrow('CONFLICT');
    const old = current(before.trip, 'region', regionId)!;
    const stale = { ...region(tripId, regionId), previousRevisionId: old.revisionId };
    await expect(
      repo.execute(batch(tripId, 1, [region(tripId, uuid())], [{ expectedRevisionId: uuid(), content: stale }])),
    ).rejects.toThrow('CONFLICT');
    expect(await snapshot(db, repo, tripId)).toEqual(before);
  });

  it('비활성 지역을 새 장소가 참조하면 거부한다', async () => {
    const { repo } = await setup();
    const tripId = await newTrip(repo);
    const regionId = uuid();
    await repo.execute(batch(tripId, 0, [region(tripId, regionId)]));
    const revisionId = current(await repo.get(tripId), 'region', regionId)!.revisionId;
    await repo.execute(
      envelope(tripId, 'DeactivateContent', { target: { targetKind: 'region', entityId: regionId, revisionId } }, 1),
    );
    await expect(repo.execute(batch(tripId, 2, [place(tripId, uuid(), [regionId])]))).rejects.toThrow(
      'BROKEN_REFERENCE',
    );
  });

  it('같은 요청은 다시 쓰지 않고, 같은 요청 ID의 다른 입력은 거부한다', async () => {
    const { db, repo } = await setup();
    const tripId = await newTrip(repo);
    const input = batch(tripId, 0, [region(tripId, uuid())]);
    const first = await repo.execute(input);
    const afterFirst = await snapshot(db, repo, tripId);
    const again = await repo.execute(input);
    expect(again.status).toBe('replayed');
    expect(again.domainRevision).toBe(first.domainRevision);
    expect(await snapshot(db, repo, tripId)).toEqual(afterFirst);
    await expect(repo.execute(batch(tripId, 0, [region(tripId, uuid())], [], input.requestId))).rejects.toThrow(
      'REQUEST_ID_REUSED',
    );
  });

  it('저장 도중 쓰기가 실패하면 콘텐츠·head·revision·영수증이 모두 남지 않는다', async () => {
    const { db, repo } = await setup();
    const tripId = await newTrip(repo);
    const regionId = uuid();
    await repo.execute(batch(tripId, 0, [region(tripId, regionId)]));
    const before = await snapshot(db, repo, tripId);
    const receipts = db.table('command_receipts');
    const originalAdd = receipts.add.bind(receipts);
    receipts.add = (() => {
      throw new DOMException('가상 쓰기 실패', 'QuotaExceededError');
    }) as typeof receipts.add;
    const { placeId, create } = placeWithGuide(tripId, regionId);
    await expect(repo.execute(batch(tripId, 1, create))).rejects.toThrow();
    receipts.add = originalAdd;
    expect(await snapshot(db, repo, tripId)).toEqual(before);
    await repo.execute(batch(tripId, 1, create));
    expect(current(await repo.get(tripId), 'place', placeId)).toBeTruthy();
  });

  it('과거 계획과 현장 기록은 그대로이고 두 여행의 콘텐츠는 섞이지 않는다', async () => {
    const { repo } = await setup();
    const tripId = await newTrip(repo);
    const otherTripId = await newTrip(repo, '다른 가상 여행');
    await repo.execute(
      envelope(
        tripId,
        'AddNote',
        {
          record: {
            tripId,
            recordId: uuid(),
            kind: 'note',
            sourceRefs: [],
            payload: {
              targetRef: { tripId, targetKind: 'trip', entityId: tripId },
              body: '가상 메모',
              contextRefs: [],
            },
          },
        },
        0,
      ),
    );
    const before = await repo.get(tripId);
    const otherBefore = await repo.get(otherTripId);
    await repo.execute(batch(tripId, before.header.domainRevision, [region(tripId, uuid())]));
    const after = await repo.get(tripId);
    expect(after.plans).toEqual(before.plans);
    expect(after.records).toEqual(before.records);
    expect(await repo.get(otherTripId)).toEqual(otherBefore);
    expect(await repo.catalog(otherTripId, 'region')).toEqual([]);
    expect(await repo.catalog(tripId, 'region')).toHaveLength(1);
  });
});

describe('CreateContentBatch · 기존 활성 소유 연결 보존 (C-01 R1)', () => {
  async function withPlace() {
    const ctx = await setup();
    const tripId = await newTrip(ctx.repo);
    const regionId = uuid();
    await ctx.repo.execute(batch(tripId, 0, [region(tripId, regionId)]));
    const first = placeWithGuide(tripId, regionId);
    await ctx.repo.execute(batch(tripId, 1, first.create));
    return { ...ctx, tripId, regionId, ...first, revision: 2 };
  }

  it('기존 활성 본문 G1을 두고 장소를 새 본문 G2로 바꾸는 갱신은 거부하고 상태를 바꾸지 않는다', async () => {
    const { db, repo, tripId, regionId, placeId, revision } = await withPlace();
    const before = await snapshot(db, repo, tripId);
    const oldPlace = current(before.trip, 'place', placeId)!;
    const newGuideId = uuid();
    const updated = { ...place(tripId, placeId, [regionId], newGuideId), previousRevisionId: oldPlace.revisionId };
    await expect(
      repo.execute(
        batch(
          tripId,
          revision,
          [guide(tripId, newGuideId, 'place-guide', 'place', placeId)],
          [{ expectedRevisionId: oldPlace.revisionId, content: updated }],
        ),
      ),
    ).rejects.toThrow('CONFLICT');
    expect(await snapshot(db, repo, tripId)).toEqual(before);
  });

  it('기존 지역 가이드를 목록에서 빼거나 바꾸는 갱신은 거부하고, 유지하면서 하나 더하는 갱신은 허용한다', async () => {
    const { db, repo } = await setup();
    const tripId = await newTrip(repo);
    const regionId = uuid();
    const firstGuide = uuid();
    await repo.execute(
      batch(tripId, 0, [
        region(tripId, regionId, [firstGuide]),
        guide(tripId, firstGuide, 'region-guide', 'region', regionId),
      ]),
    );
    const before = await snapshot(db, repo, tripId);
    const oldRegion = current(before.trip, 'region', regionId)!;
    const secondGuide = uuid();
    const update = (guideIds: string[]) => [
      {
        expectedRevisionId: oldRegion.revisionId,
        content: { ...region(tripId, regionId, guideIds), previousRevisionId: oldRegion.revisionId },
      },
    ];
    const secondCreate = () => [guide(tripId, secondGuide, 'region-guide', 'region', regionId)];
    for (const guideIds of [[secondGuide], []]) {
      await expect(repo.execute(batch(tripId, 1, secondCreate(), update(guideIds)))).rejects.toThrow('CONFLICT');
      expect(await snapshot(db, repo, tripId)).toEqual(before);
    }
    await repo.execute(batch(tripId, 1, secondCreate(), update([firstGuide, secondGuide])));
    const after = await repo.get(tripId);
    const region2 = current(after, 'region', regionId)!;
    expect(region2.kind === 'region' && region2.payload.guideIds).toEqual([firstGuide, secondGuide]);
    expect(after.contents.find((c) => c.revisionId === oldRegion.revisionId)).toEqual(oldRegion);
  });

  it('장소의 다른 필드만 바꾸는 갱신은 기존 본문 연결을 유지한 채 허용한다', async () => {
    const { repo, tripId, regionId, placeId, guideId, revision } = await withPlace();
    const oldPlace = current(await repo.get(tripId), 'place', placeId)!;
    const renamed = place(tripId, placeId, [regionId], guideId);
    (renamed.payload as { name: string }).name = '이름만 바뀐 장소';
    await repo.execute(
      batch(
        tripId,
        revision,
        [region(tripId, uuid())],
        [{ expectedRevisionId: oldPlace.revisionId, content: { ...renamed, previousRevisionId: oldPlace.revisionId } }],
      ),
    );
    const after = current(await repo.get(tripId), 'place', placeId)!;
    expect(after.kind === 'place' && after.payload.guideId).toBe(guideId);
  });
});
