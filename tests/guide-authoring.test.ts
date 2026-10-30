import { afterEach, describe, expect, it } from 'vitest';
import { ContentRepository, TravelDB } from '../src/repository';
import { buildNewTrip } from '../src/content/trip-factory';
import { canonicalJson, digestBytes } from '../src/contracts/v2/index';
import type { ContentRevision, PlanVersion, TripDataset } from '../src/contracts/v2/index';
import { currentMappings } from '../src/transfer/normalize';
import { fixtureAssets } from './fixtures/pilot';
import { factIsolation, factIsolationTrip } from './fixtures/guide-fact-isolation';

/** C-03 T-C4: 지역·여행 공통 가이드 작성/수정과 기본정보 수정의 저장 규칙. 가상 여행만 사용한다. */
const databases: TravelDB[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close();
    await database.delete();
  }
});

type Input = Record<string, unknown>;
type Guide = Extract<ContentRevision, { kind: 'guide' }>;
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
  normalizationVersion: 'c03',
  tripId,
  requestId,
  kind,
  payload,
  ...(expectedDomainRevision === undefined ? {} : { expectedDomainRevision }),
});
const base = (tripId: string, kind: string, entityId: string) => ({
  tripId,
  kind,
  entityId,
  revisionId: uuid(),
  schemaVersion: 2,
  sourceRefs: [],
});
const section = (key: string, order: number, bodyMd = `${key} 본문`) => ({
  key,
  title: `${key} 제목`,
  order,
  bodyMd,
  factRefs: [],
  assetRefs: [],
  linkRefs: [],
});
const regionInput = (tripId: string, entityId: string, guideIds: string[] = [], extra: Input = {}): Input => ({
  ...base(tripId, 'region', entityId),
  payload: { name: '가상 지역', guideIds, assetRefs: [], ...extra },
});
const placeInput = (tripId: string, entityId: string, regionIds: string[], extra: Input = {}): Input => ({
  ...base(tripId, 'place', entityId),
  payload: {
    regionIds,
    name: '가상 장소',
    aliases: [],
    placeKind: 'sight',
    summary: '가상 요약',
    dontMiss: [],
    assetRefs: [],
    ...extra,
  },
});
const guideInput = (
  tripId: string,
  entityId: string,
  documentKind: string,
  owner: { targetKind: string; entityId: string },
  sections = [section('intro', 0)],
  title = '가상 가이드',
): Input => ({
  ...base(tripId, 'guide', entityId),
  payload: {
    documentKind,
    ownerRef: { tripId, ...owner },
    title,
    sections,
    factBindings: [],
    assetRefs: [],
  },
});

async function setup() {
  const db = new TravelDB(`guides-${uuid()}`);
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
const current = (trip: TripDataset, kind: ContentRevision['kind'], entityId: string) => {
  const head = trip.heads.find((h) => h.targetKind === kind && h.entityId === entityId);
  return trip.contents.find((c) => c.kind === kind && c.entityId === entityId && c.revisionId === head?.revisionId);
};
const snapshot = async (db: TravelDB, repo: ContentRepository, tripId: string) => ({
  trip: await repo.get(tripId),
  receipts: await db.table('command_receipts').count(),
  meta: await repo.meta(),
});

async function withRegion() {
  const ctx = await setup();
  const tripId = await newTrip(ctx.repo);
  const regionId = uuid();
  await ctx.repo.execute(
    envelope(tripId, 'CreateContentBatch', { create: [regionInput(tripId, regionId)], updateOwners: [] }, 0),
  );
  return { ...ctx, tripId, regionId };
}
/** 지역에 가이드를 추가하는 배치(기존 guideIds를 유지하고 새 ID를 뒤에 붙인다). */
async function addRegionGuide(
  repo: ContentRepository,
  tripId: string,
  regionId: string,
  title: string,
  sections = [section('intro', 0, `${title} 본문`)],
) {
  const trip = await repo.get(tripId);
  const region = current(trip, 'region', regionId);
  if (region?.kind !== 'region') {
    throw new Error('지역 누락');
  }
  const guideId = uuid();
  const { commitSeq: _s, recordedAt: _r, actor: _a, ...rest } = region;
  const updated = {
    ...rest,
    revisionId: uuid(),
    previousRevisionId: region.revisionId,
    payload: { ...region.payload, guideIds: [...region.payload.guideIds, guideId] },
  };
  await repo.execute(
    envelope(
      tripId,
      'CreateContentBatch',
      {
        create: [
          guideInput(tripId, guideId, 'region-guide', { targetKind: 'region', entityId: regionId }, sections, title),
        ],
        updateOwners: [{ expectedRevisionId: region.revisionId, content: updated }],
      },
      trip.header.domainRevision,
    ),
  );
  return guideId;
}

describe('지역 가이드 작성', () => {
  it('가이드와 지역 연결을 한 번에 저장하고 기존 가이드 연결을 유지한다', async () => {
    const { repo, tripId, regionId } = await withRegion();
    const first = await addRegionGuide(repo, tripId, regionId, '첫 가이드');
    const beforeSecond = await repo.get(tripId);
    const second = await addRegionGuide(repo, tripId, regionId, '둘째 가이드');
    const trip = await repo.get(tripId);
    const region = current(trip, 'region', regionId);
    expect(region?.kind === 'region' && region.payload.guideIds).toEqual([first, second]);
    expect(trip.header.domainRevision).toBe(beforeSecond.header.domainRevision + 1);
    expect(current(trip, 'guide', second)).toBeTruthy();
    // 이전 지역 revision은 그대로 남는다.
    const oldRegion = current(beforeSecond, 'region', regionId)!;
    expect(trip.contents.find((c) => c.revisionId === oldRegion.revisionId)).toEqual(oldRegion);
  });

  it('지역 revision이 오래되었거나 다른 변경이 먼저 저장됐다면 거부하고 상태를 바꾸지 않는다', async () => {
    const { db, repo, tripId, regionId } = await withRegion();
    const stale = await repo.get(tripId);
    await addRegionGuide(repo, tripId, regionId, '다른 탭의 가이드');
    const before = await snapshot(db, repo, tripId);
    const region = current(stale, 'region', regionId)!;
    const guideId = uuid();
    const { commitSeq: _s, recordedAt: _r, actor: _a, ...rest } = region;
    const updated = {
      ...rest,
      revisionId: uuid(),
      previousRevisionId: region.revisionId,
      payload: { ...(region as { payload: object }).payload, guideIds: [guideId] },
    };
    const create = [guideInput(tripId, guideId, 'region-guide', { targetKind: 'region', entityId: regionId })];
    // 도메인 revision이 오래되면 거부한다.
    await expect(
      repo.execute(
        envelope(
          tripId,
          'CreateContentBatch',
          { create, updateOwners: [{ expectedRevisionId: region.revisionId, content: updated }] },
          stale.header.domainRevision,
        ),
      ),
    ).rejects.toThrow('CONFLICT');
    // 도메인 revision이 최신이어도 오래된 지역 revision을 기준으로 하면 거부한다.
    await expect(
      repo.execute(
        envelope(
          tripId,
          'CreateContentBatch',
          { create, updateOwners: [{ expectedRevisionId: region.revisionId, content: updated }] },
          before.trip.header.domainRevision,
        ),
      ),
    ).rejects.toThrow('CONFLICT');
    expect(await snapshot(db, repo, tripId)).toEqual(before);
  });

  it('지역이 가리키지 않는 가이드·섹션 없는 가이드·중복 ID·다른 소유자는 거부한다', async () => {
    const { db, repo, tripId, regionId } = await withRegion();
    const guideId = await addRegionGuide(repo, tripId, regionId, '기존 가이드');
    const otherRegionId = uuid();
    const trip0 = await repo.get(tripId);
    await repo.execute(
      envelope(
        tripId,
        'CreateContentBatch',
        { create: [regionInput(tripId, otherRegionId)], updateOwners: [] },
        trip0.header.domainRevision,
      ),
    );
    const before = await snapshot(db, repo, tripId);
    const revision = before.trip.header.domainRevision;
    const owner = { targetKind: 'region', entityId: regionId };
    const cases: [string, Input[], string][] = [
      ['지역이 가리키지 않는 가이드', [guideInput(tripId, uuid(), 'region-guide', owner)], 'BROKEN_REFERENCE'],
      ['섹션이 없는 가이드', [guideInput(tripId, uuid(), 'region-guide', owner, [])], 'BROKEN_REFERENCE'],
      ['이미 있는 가이드 ID', [guideInput(tripId, guideId, 'region-guide', owner)], 'CONFLICT'],
      [
        '없는 지역의 가이드',
        [guideInput(tripId, uuid(), 'region-guide', { targetKind: 'region', entityId: uuid() })],
        'BROKEN_REFERENCE',
      ],
      [
        '지원하지 않는 가이드 종류(구조화 문서)',
        [guideInput(tripId, uuid(), 'language-guide', owner)],
        'INVALID_INPUT',
      ],
    ];
    for (const [, create, code] of cases) {
      await expect(
        repo.execute(envelope(tripId, 'CreateContentBatch', { create, updateOwners: [] }, revision)),
      ).rejects.toThrow(code === 'INVALID_INPUT' ? /INVALID_INPUT|Invalid|invalid/i : code);
    }
    // 다른 지역으로 가는 연결로 가이드 소유자를 속이는 경우(소유자는 A, 연결은 B)
    const trip = before.trip;
    const regionB = current(trip, 'region', otherRegionId)!;
    const guideForA = uuid();
    const { commitSeq: _s, recordedAt: _r, actor: _a, ...rest } = regionB;
    await expect(
      repo.execute(
        envelope(
          tripId,
          'CreateContentBatch',
          {
            create: [guideInput(tripId, guideForA, 'region-guide', owner)],
            updateOwners: [
              {
                expectedRevisionId: regionB.revisionId,
                content: {
                  ...rest,
                  revisionId: uuid(),
                  previousRevisionId: regionB.revisionId,
                  payload: { ...(regionB as { payload: object }).payload, guideIds: [guideForA] },
                },
              },
            ],
          },
          revision,
        ),
      ),
    ).rejects.toThrow('BROKEN_REFERENCE');
    expect(await snapshot(db, repo, tripId)).toEqual(before);
  });

  it('저장 도중 쓰기가 실패하면 가이드·지역 revision·영수증이 모두 남지 않고, 다시 시도하면 저장된다', async () => {
    const { db, repo, tripId, regionId } = await withRegion();
    const before = await snapshot(db, repo, tripId);
    const receipts = db.table('command_receipts');
    const originalAdd = receipts.add.bind(receipts);
    receipts.add = (() => {
      throw new DOMException('가상 쓰기 실패', 'QuotaExceededError');
    }) as typeof receipts.add;
    await expect(addRegionGuide(repo, tripId, regionId, '실패할 가이드')).rejects.toThrow();
    receipts.add = originalAdd;
    expect(await snapshot(db, repo, tripId)).toEqual(before);
    await addRegionGuide(repo, tripId, regionId, '다시 시도한 가이드');
    expect((await repo.catalog(tripId, 'guide')).map((g) => g.kind === 'guide' && g.payload.title)).toEqual([
      '다시 시도한 가이드',
    ]);
  });

  it('같은 요청은 다시 쓰지 않고 가이드를 중복 만들지 않는다', async () => {
    const { db, repo, tripId, regionId } = await withRegion();
    const trip = await repo.get(tripId);
    const region = current(trip, 'region', regionId)!;
    const guideId = uuid();
    const { commitSeq: _s, recordedAt: _r, actor: _a, ...rest } = region;
    const request = envelope(
      tripId,
      'CreateContentBatch',
      {
        create: [guideInput(tripId, guideId, 'region-guide', { targetKind: 'region', entityId: regionId })],
        updateOwners: [
          {
            expectedRevisionId: region.revisionId,
            content: {
              ...rest,
              revisionId: uuid(),
              previousRevisionId: region.revisionId,
              payload: { ...(region as { payload: object }).payload, guideIds: [guideId] },
            },
          },
        ],
      },
      trip.header.domainRevision,
    );
    const first = await repo.execute(request);
    const afterFirst = await snapshot(db, repo, tripId);
    const again = await repo.execute(request);
    expect(again.status).toBe('replayed');
    expect(await snapshot(db, repo, tripId)).toEqual(afterFirst);
    expect(await repo.catalog(tripId, 'guide')).toHaveLength(1);
    expect(first.domainRevision).toBe(afterFirst.trip.header.domainRevision);
  });
});

describe('여행 공통 가이드 작성', () => {
  const tripOwner = (tripId: string) => ({ targetKind: 'trip', entityId: tripId });

  it('이 여행을 소유자로 하는 준비 가이드를 저장하고 목록에서 찾는다', async () => {
    const { repo } = await setup();
    const tripId = await newTrip(repo);
    const guideId = uuid();
    await repo.execute(
      envelope(
        tripId,
        'CreateContentBatch',
        {
          create: [guideInput(tripId, guideId, 'preparation', tripOwner(tripId), [section('a', 0), section('b', 1)])],
          updateOwners: [],
        },
        0,
      ),
    );
    const guides = await repo.catalog(tripId, 'guide');
    expect(guides).toHaveLength(1);
    const saved = guides[0] as Guide;
    expect(saved.entityId).toBe(guideId);
    expect(saved.sourceRefs).toEqual([]);
    expect(saved.payload.sections.map((s) => s.key)).toEqual(['a', 'b']);
    expect((await repo.get(tripId)).header.domainRevision).toBe(1);
  });

  it('다른 여행·다른 소유자·섹션 없음·구조화 종류는 거부하고 두 여행은 섞이지 않는다', async () => {
    const { db, repo } = await setup();
    const tripId = await newTrip(repo);
    const otherTripId = await newTrip(repo, '다른 가상 여행');
    const regionId = uuid();
    await repo.execute(
      envelope(tripId, 'CreateContentBatch', { create: [regionInput(tripId, regionId)], updateOwners: [] }, 0),
    );
    const before = await snapshot(db, repo, tripId);
    const otherBefore = await repo.get(otherTripId);
    const revision = before.trip.header.domainRevision;
    const cases: [string, Input[]][] = [
      [
        '다른 여행을 소유자로 한 가이드',
        [guideInput(tripId, uuid(), 'preparation', { targetKind: 'trip', entityId: otherTripId })],
      ],
      [
        '지역을 소유자로 한 준비 가이드',
        [guideInput(tripId, uuid(), 'preparation', { targetKind: 'region', entityId: regionId })],
      ],
      ['섹션이 없는 준비 가이드', [guideInput(tripId, uuid(), 'preparation', tripOwner(tripId), [])]],
      ['구조화 교통 가이드', [guideInput(tripId, uuid(), 'transit', tripOwner(tripId))]],
    ];
    for (const [, create] of cases) {
      await expect(
        repo.execute(envelope(tripId, 'CreateContentBatch', { create, updateOwners: [] }, revision)),
      ).rejects.toThrow();
    }
    // 다른 여행의 tripId를 가진 소유자 참조(여행 간 오염)
    const foreign = guideInput(tripId, uuid(), 'preparation', tripOwner(tripId));
    (foreign.payload as { ownerRef: { tripId: string } }).ownerRef.tripId = otherTripId;
    await expect(
      repo.execute(envelope(tripId, 'CreateContentBatch', { create: [foreign], updateOwners: [] }, revision)),
    ).rejects.toThrow('BROKEN_REFERENCE');
    expect(await snapshot(db, repo, tripId)).toEqual(before);
    expect(await repo.get(otherTripId)).toEqual(otherBefore);
    expect(await repo.catalog(otherTripId, 'guide')).toEqual([]);
  });
});

describe('가이드 수정', () => {
  async function withTripGuide() {
    const ctx = await setup();
    const tripId = await newTrip(ctx.repo);
    const guideId = uuid();
    await ctx.repo.execute(
      envelope(
        tripId,
        'CreateContentBatch',
        {
          create: [
            guideInput(tripId, guideId, 'preparation', { targetKind: 'trip', entityId: tripId }, [
              section('a', 0, '처음 본문'),
              section('b', 1, '둘째 본문'),
            ]),
          ],
          updateOwners: [],
        },
        0,
      ),
    );
    return { ...ctx, tripId, guideId };
  }
  const editSection = (tripId: string, guide: Guide, key: string, bodyMd: string, expected: number) =>
    envelope(
      tripId,
      'EditContentSection',
      {
        target: { targetKind: 'guide', entityId: guide.entityId, revisionId: guide.revisionId },
        section: { ...guide.payload.sections.find((s) => s.key === key)!, bodyMd },
      },
      expected,
    );

  it('섹션 본문을 고치면 새 revision이 생기고 다른 섹션·이전 revision은 그대로다', async () => {
    const { repo, tripId, guideId } = await withTripGuide();
    const trip = await repo.get(tripId);
    const guide = current(trip, 'guide', guideId) as Guide;
    await repo.execute(editSection(tripId, guide, 'a', '고친 본문', trip.header.domainRevision));
    const after = await repo.get(tripId);
    const next = current(after, 'guide', guideId) as Guide;
    expect(next.revisionId).not.toBe(guide.revisionId);
    expect(next.previousRevisionId).toBe(guide.revisionId);
    expect(next.payload.sections.find((s) => s.key === 'a')?.bodyMd).toBe('고친 본문');
    expect(next.payload.sections.find((s) => s.key === 'b')).toEqual(guide.payload.sections[1]);
    expect(after.contents.find((c) => c.revisionId === guide.revisionId)).toEqual(guide);
  });

  it('오래된 도메인·콘텐츠 revision과 다른 탭의 현장 기록 뒤의 저장은 거부한다', async () => {
    const { db, repo, tripId, guideId } = await withTripGuide();
    const stale = await repo.get(tripId);
    const guide = current(stale, 'guide', guideId) as Guide;
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
              body: '다른 탭 메모',
              contextRefs: [],
            },
          },
        },
        stale.header.domainRevision,
      ),
    );
    const before = await snapshot(db, repo, tripId);
    await expect(
      repo.execute(editSection(tripId, guide, 'a', '오래된 화면의 저장', stale.header.domainRevision)),
    ).rejects.toThrow('CONFLICT');
    // 최신 도메인 revision이어도 이미 대체된 콘텐츠 revision을 기준으로는 저장할 수 없다.
    await repo.execute(editSection(tripId, guide, 'a', '먼저 저장', before.trip.header.domainRevision));
    const mid = await snapshot(db, repo, tripId);
    await expect(
      repo.execute(editSection(tripId, guide, 'b', '대체된 revision 기준', mid.trip.header.domainRevision)),
    ).rejects.toThrow('CONFLICT');
    expect(await snapshot(db, repo, tripId)).toEqual(mid);
  });

  it('제목 수정은 섹션·소유자·종류·Fact 연결·첨부를 바꾸지 못한다', async () => {
    const { db, repo, tripId, guideId } = await withTripGuide();
    const trip = await repo.get(tripId);
    const guide = current(trip, 'guide', guideId) as Guide;
    const { commitSeq: _s, recordedAt: _r, actor: _a, ...rest } = guide;
    const update = (payload: object, expectedRevision = trip.header.domainRevision) =>
      envelope(
        tripId,
        'UpdateContent',
        {
          expectedRevisionId: guide.revisionId,
          content: { ...rest, revisionId: uuid(), previousRevisionId: guide.revisionId, payload },
        },
        expectedRevision,
      );
    const before = await snapshot(db, repo, tripId);
    const bad: Input[] = [
      { ...guide.payload, sections: [] },
      { ...guide.payload, sections: guide.payload.sections.map((s) => ({ ...s, bodyMd: '' })) },
      { ...guide.payload, documentKind: 'region-guide' },
      { ...guide.payload, ownerRef: { tripId, targetKind: 'region', entityId: uuid() } },
    ];
    for (const payload of bad) {
      await expect(repo.execute(update(payload))).rejects.toThrow();
    }
    expect(await snapshot(db, repo, tripId)).toEqual(before);
    await repo.execute(update({ ...guide.payload, title: '새 제목' }));
    const next = current(await repo.get(tripId), 'guide', guideId) as Guide;
    expect(next.payload.title).toBe('새 제목');
    expect(next.payload.sections).toEqual(guide.payload.sections);
    expect(next.payload.ownerRef).toEqual(guide.payload.ownerRef);
  });
});

describe('지역·장소 기본정보 수정', () => {
  async function withPlace() {
    const ctx = await setup();
    const tripId = await newTrip(ctx.repo);
    const regionA = uuid();
    const regionB = uuid();
    const placeId = uuid();
    const guideId = uuid();
    await ctx.repo.execute(
      envelope(
        tripId,
        'CreateContentBatch',
        {
          create: [
            regionInput(tripId, regionA, [], { nameKo: '한글 이름', rainPlan: '비 오면 실내', tagline: '처음 소개' }),
            regionInput(tripId, regionB),
            placeInput(tripId, placeId, [regionA], {
              aliases: ['별칭 하나'],
              dontMiss: ['놓치지 말 것'],
              wikiRef: 'https://example.invalid/wiki',
              grade: 'A',
              guideId,
            }),
            guideInput(tripId, guideId, 'place-guide', { targetKind: 'place', entityId: placeId }, [
              section('why_go', 0, '이유'),
              section('deep', 1),
              section('practical', 2),
            ]),
          ],
          updateOwners: [],
        },
        0,
      ),
    );
    return { ...ctx, tripId, regionA, regionB, placeId, guideId };
  }
  const updateContent = (
    tripId: string,
    previous: ContentRevision,
    payload: object,
    expected: number,
    expectedRevisionId = previous.revisionId,
  ) => {
    const { commitSeq: _s, recordedAt: _r, actor: _a, ...rest } = previous;
    return envelope(
      tripId,
      'UpdateContent',
      { expectedRevisionId, content: { ...rest, revisionId: uuid(), previousRevisionId: expectedRevisionId, payload } },
      expected,
    );
  };

  it('지역 이름·소개·설명만 바꾸고 나머지 필드·가이드 연결은 그대로 둔다. 과거 계획은 당시 이름을 읽는다', async () => {
    const { repo, tripId, regionA, placeId } = await withPlace();
    let trip = await repo.get(tripId);
    const plan = trip.plans[0];
    await repo.execute(
      envelope(
        tripId,
        'ChangePlan',
        {
          currentPlanVersionId: plan.planVersionId,
          operations: [
            {
              type: 'upsert-item',
              item: {
                tripId,
                planVersionId: plan.planVersionId,
                activityId: uuid(),
                dayId: plan.days[0].dayId,
                order: 0,
                title: '가상 활동',
                category: 'activity',
                time: { start: { precision: 'unspecified' } },
                summary: '',
                optional: false,
                placeLinks: [{ placeId, relation: 'visit' }],
                bookingIds: [],
                taskRefs: [],
                executionMarkers: [],
                sourceFlags: [],
              },
            },
          ],
          reason: '가상 일정',
        },
        trip.header.domainRevision,
      ),
    );
    trip = await repo.get(tripId);
    const pinned = trip.plans[1] as PlanVersion;
    const region = current(trip, 'region', regionA)!;
    if (region.kind !== 'region') {
      throw new Error('지역 누락');
    }
    await repo.execute(
      updateContent(
        tripId,
        region,
        { ...region.payload, name: '새 이름', tagline: '새 소개', introduction: '새 설명' },
        trip.header.domainRevision,
      ),
    );
    const after = await repo.get(tripId);
    const next = current(after, 'region', regionA);
    expect(next?.kind === 'region' && next.payload).toEqual({
      ...region.payload,
      name: '새 이름',
      tagline: '새 소개',
      introduction: '새 설명',
    });
    // 과거 계획의 고정 맥락은 그대로이고 그 revision으로 읽으면 당시 이름이 나온다.
    expect(after.plans[1]).toEqual(pinned);
    const ref = pinned.contextRefs.find((r) => r.targetKind === 'region' && r.entityId === regionA)!;
    const old = await repo.content(tripId, 'region', regionA, ref.revisionId);
    expect(old?.kind === 'region' && old.payload.name).toBe('가상 지역');
    expect(after.records).toEqual(trip.records);
  });

  it('장소 이름·종류·요약·지역을 바꾸고 별칭·놓치지 말 것·위키·등급·본문 연결은 보존한다', async () => {
    const { repo, tripId, regionA, regionB, placeId, guideId } = await withPlace();
    const trip = await repo.get(tripId);
    const place = current(trip, 'place', placeId)!;
    if (place.kind !== 'place') {
      throw new Error('장소 누락');
    }
    await repo.execute(
      updateContent(
        tripId,
        place,
        { ...place.payload, name: '새 장소', placeKind: 'food', summary: '새 요약', regionIds: [regionB] },
        trip.header.domainRevision,
      ),
    );
    const next = current(await repo.get(tripId), 'place', placeId);
    expect(next?.kind === 'place' && next.payload).toEqual({
      ...place.payload,
      name: '새 장소',
      placeKind: 'food',
      summary: '새 요약',
      regionIds: [regionB],
    });
    expect(next?.kind === 'place' && next.payload.guideId).toBe(guideId);
    // 지역 없는 장소도 허용한다.
    const latest = await repo.get(tripId);
    const second = current(latest, 'place', placeId)!;
    if (second.kind !== 'place') {
      throw new Error('장소 누락');
    }
    await repo.execute(
      updateContent(tripId, second, { ...second.payload, regionIds: [] }, latest.header.domainRevision),
    );
    const none = current(await repo.get(tripId), 'place', placeId);
    expect(none?.kind === 'place' && none.payload.regionIds).toEqual([]);
    expect(regionA).toBeTruthy();
  });

  it('없는 지역·비활성 지역·다른 여행 지역을 새로 연결하거나 본문 연결을 바꾸는 수정은 거부한다', async () => {
    const { db, repo, tripId, regionA, regionB, placeId } = await withPlace();
    const otherTripId = await newTrip(repo, '다른 가상 여행');
    const foreignRegion = uuid();
    await repo.execute(
      envelope(
        otherTripId,
        'CreateContentBatch',
        { create: [regionInput(otherTripId, foreignRegion)], updateOwners: [] },
        0,
      ),
    );
    let trip = await repo.get(tripId);
    const regionRow = current(trip, 'region', regionB)!;
    await repo.execute(
      envelope(
        tripId,
        'DeactivateContent',
        { target: { targetKind: 'region', entityId: regionB, revisionId: regionRow.revisionId } },
        trip.header.domainRevision,
      ),
    );
    trip = await repo.get(tripId);
    const place = current(trip, 'place', placeId)!;
    if (place.kind !== 'place') {
      throw new Error('장소 누락');
    }
    const before = await snapshot(db, repo, tripId);
    const otherBefore = await repo.get(otherTripId);
    const revision = trip.header.domainRevision;
    const bad: [string, object][] = [
      ['비활성 지역', { ...place.payload, regionIds: [regionA, regionB] }],
      ['없는 지역', { ...place.payload, regionIds: [uuid()] }],
      ['다른 여행의 지역', { ...place.payload, regionIds: [foreignRegion] }],
      ['본문 연결 제거', { ...place.payload, guideId: undefined }],
      ['다른 본문으로 교체', { ...place.payload, guideId: uuid() }],
    ];
    for (const [, payload] of bad) {
      await expect(repo.execute(updateContent(tripId, place, payload, revision))).rejects.toThrow();
    }
    expect(await snapshot(db, repo, tripId)).toEqual(before);
    expect(await repo.get(otherTripId)).toEqual(otherBefore);
  });

  it('지역의 가이드 연결·장소 종류를 바꾸지 못하고, 오래된 기준과 비활성 콘텐츠 수정은 거부한다', async () => {
    const { db, repo, tripId, regionA, placeId } = await withPlace();
    const trip = await repo.get(tripId);
    const region = current(trip, 'region', regionA)!;
    if (region.kind !== 'region') {
      throw new Error('지역 누락');
    }
    const before = await snapshot(db, repo, tripId);
    await expect(
      repo.execute(
        updateContent(tripId, region, { ...region.payload, guideIds: [uuid()] }, trip.header.domainRevision),
      ),
    ).rejects.toThrow();
    await expect(
      repo.execute(
        updateContent(tripId, region, { ...region.payload, name: '오래된 기준' }, trip.header.domainRevision, uuid()),
      ),
    ).rejects.toThrow('CONFLICT');
    await expect(
      repo.execute(
        updateContent(tripId, region, { ...region.payload, name: '오래된 도메인' }, trip.header.domainRevision - 1),
      ),
    ).rejects.toThrow('CONFLICT');
    expect(await snapshot(db, repo, tripId)).toEqual(before);
    // 비활성화된 장소는 수정할 수 없다.
    const place = current(trip, 'place', placeId)!;
    await repo.execute(
      envelope(
        tripId,
        'DeactivateContent',
        { target: { targetKind: 'place', entityId: placeId, revisionId: place.revisionId } },
        trip.header.domainRevision,
      ),
    );
    const after = await repo.get(tripId);
    if (place.kind !== 'place') {
      throw new Error('장소 누락');
    }
    await expect(
      repo.execute(
        updateContent(tripId, place, { ...place.payload, name: '비활성 수정' }, after.header.domainRevision),
      ),
    ).rejects.toThrow();
  });
});

describe('Fact 연결이 있는 가이드의 수정', () => {
  it('제목 수정과 섹션 편집 뒤에도 토큰·바인딩·출처가 유지되고 Fact 값은 같은 곳을 가리킨다', async () => {
    const { repo } = await setup();
    const trip = await factIsolationTrip();
    const tripId = trip.header.tripId;
    const assets = new Map<string, Uint8Array>();
    for (const bytes of Object.values(fixtureAssets)) {
      assets.set(await digestBytes(bytes), bytes);
    }
    const provenance = {
      packageId: `package-${tripId}`,
      packageDigest: await digestBytes(new TextEncoder().encode(canonicalJson(trip))),
      lineageId: `lineage-${tripId}`,
      adapterVersion: '1',
      manifest: {},
      report: {},
      mappings: currentMappings(trip),
    };
    await repo.prepareImport(trip, assets, provenance);
    await repo.execute(
      envelope(tripId, 'ImportNewTrip', { packageId: provenance.packageId, packageDigest: provenance.packageDigest }),
    );
    const imported = await repo.get(tripId);
    const guide = current(imported, 'guide', factIsolation.guideA.guideId) as Guide;
    expect(guide.payload.factBindings.length).toBeGreaterThan(0);
    const { commitSeq: _s, recordedAt: _r, actor: _a, ...rest } = guide;
    await repo.execute(
      envelope(
        tripId,
        'UpdateContent',
        {
          expectedRevisionId: guide.revisionId,
          content: {
            ...rest,
            revisionId: uuid(),
            previousRevisionId: guide.revisionId,
            payload: { ...guide.payload, title: '고친 제목' },
          },
        },
        imported.header.domainRevision,
      ),
    );
    const titled = await repo.get(tripId);
    const afterTitle = current(titled, 'guide', guide.entityId) as Guide;
    expect(afterTitle.payload.title).toBe('고친 제목');
    expect(afterTitle.payload.factBindings).toEqual(guide.payload.factBindings);
    expect(afterTitle.payload.sections).toEqual(guide.payload.sections);
    expect(afterTitle.sourceRefs).toEqual(guide.sourceRefs);
    // 토큰을 그대로 둔 채 섹션 본문을 고치면 바인딩이 유지된다. 바인딩 없는 토큰은 거부한다.
    const target = afterTitle.payload.sections.find((s) => s.bodyMd.includes('{{fact:'))!;
    await repo.execute(
      envelope(
        tripId,
        'EditContentSection',
        {
          target: { targetKind: 'guide', entityId: guide.entityId, revisionId: afterTitle.revisionId },
          section: { ...target, bodyMd: `${target.bodyMd}\n추가 문장` },
        },
        titled.header.domainRevision,
      ),
    );
    const edited = await repo.get(tripId);
    const afterEdit = current(edited, 'guide', guide.entityId) as Guide;
    expect(afterEdit.payload.factBindings).toEqual(guide.payload.factBindings);
    expect(afterEdit.payload.sections.find((s) => s.key === target.key)?.factRefs).toEqual(target.factRefs);
    await expect(
      repo.execute(
        envelope(
          tripId,
          'EditContentSection',
          {
            target: { targetKind: 'guide', entityId: guide.entityId, revisionId: afterEdit.revisionId },
            section: { ...target, bodyMd: '{{fact:없는토큰}}' },
          },
          edited.header.domainRevision,
        ),
      ),
    ).rejects.toThrow();
    expect(await repo.get(tripId)).toEqual(edited);
  });
});
