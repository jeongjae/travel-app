import { afterEach, expect, it } from 'vitest';
import Dexie from 'dexie';
import { ContentRepository, TravelDB, TravelRepository } from '../src/repository';
import { pilotTrip, fixtureAssets } from './fixtures/pilot';
import { canonicalJson, digestBytes } from '../src/contracts/v2';
import { demoTrips } from '../src/demo';
import { currentMappings } from '../src/transfer/normalize';
import { receiptSchema } from '../src/contracts/v2';
const dbs: TravelDB[] = [];
afterEach(async () => {
  for (const db of dbs.splice(0)) {
    db.close();
    await db.delete();
  }
});
const env = (
  tripId: string,
  kind: string,
  payload: unknown,
  expectedDomainRevision?: number,
  requestId: string = crypto.randomUUID(),
) => ({
  format: 'travel-app-command',
  commandVersion: 2,
  normalizationVersion: 'pilot-v1',
  tripId,
  requestId,
  kind,
  payload,
  ...(expectedDomainRevision === undefined ? {} : { expectedDomainRevision }),
});
async function setup() {
  const db = new TravelDB(`v2-test-${crypto.randomUUID()}`);
  dbs.push(db);
  const repo = new ContentRepository(db);
  await repo.init();
  return { db, repo };
}
async function seed(repo: ContentRepository, short = false) {
  const t = await pilotTrip(short),
    assets = new Map<string, Uint8Array>();
  for (const bytes of Object.values(fixtureAssets)) {
    assets.set(await digestBytes(bytes), bytes);
  }
  const prov = {
    packageId: `package-${t.header.tripId}`,
    packageDigest: await digestBytes(new TextEncoder().encode(canonicalJson(t))),
    lineageId: 'synthetic',
    adapterVersion: '1',
    manifest: {},
    report: {},
    mappings: currentMappings(t),
  };
  await repo.prepareImport(t, assets, prov);
  await repo.execute(
    env(t.header.tripId, 'ImportNewTrip', { packageId: prov.packageId, packageDigest: prov.packageDigest }),
  );
  return t;
}
it('S-01~20를 추가하면서 v1 원문과 영수증을 보호하고 검토 후 전환한다', async () => {
  const name = `legacy-upgrade-${crypto.randomUUID()}`;
  const original = new Dexie(name);
  original.version(1).stores({ trips: 'id,name,startDate' });
  const old = demoTrips()[0];
  await original.table('trips').add(old);
  original.close();
  const db = new TravelDB(name);
  dbs.push(db);
  const repo = new ContentRepository(db);
  expect((await repo.init()).mode).toBe('legacy');
  const prepared = await repo.prepareLegacy();
  expect(prepared.converted[0].dataset.plans).toHaveLength(old.versions.length);
  await repo.activateLegacy(prepared);
  expect((await repo.meta()).mode).toBe('v2');
  expect(await db.trips.get(old.id)).toEqual(old);
  expect(db.tables).toHaveLength(21);
  await expect(new TravelRepository(db).rename(old.id, old.revision, '덮어씀')).rejects.toThrow('읽기 전용');
});
it('기존 데이터가 검토 중 변경되면 전환을 취소하고 활성 영역을 유지한다', async () => {
  const { db, repo } = await setup();
  await db.delete();
  await db.open();
  const old = demoTrips()[0];
  await db.trips.add(old);
  await repo.init();
  const before = await repo.meta(),
    prepared = await repo.prepareLegacy();
  await db.trips.update(old.id, { name: '다른 탭 수정' });
  await expect(repo.activateLegacy(prepared)).rejects.toThrow('CONFLICT');
  expect((await repo.meta()).activeSpaceId).toBe(before.activeSpaceId);
  expect(await repo.list()).toEqual([]);
});
it('두 여행 저장/작은 조회/본문 revision 변경과 정확한 동일 요청 replay를 보장한다', async () => {
  const { repo } = await setup();
  const t = await seed(repo);
  await seed(repo, true);
  const before = await repo.get(t.header.tripId);
  const guide = await repo.content(t.header.tripId, 'guide', 'guide-place');
  if (guide?.kind !== 'guide') {
    throw new Error();
  }
  const cmd = env(
    t.header.tripId,
    'EditContentSection',
    {
      target: { targetKind: 'guide', entityId: guide.entityId, revisionId: guide.revisionId },
      section: { ...guide.payload.sections[2], bodyMd: '새 본문 {{fact:opening}}' },
    },
    0,
  );
  const first = await repo.execute(cmd),
    replay = await repo.execute(cmd);
  expect(replay).toEqual({ ...first, status: 'replayed' });
  const after = await repo.get(t.header.tripId);
  expect(after.plans).toEqual(before.plans);
  expect(after.records).toEqual(before.records);
  expect(after.contents.length).toBe(before.contents.length + 1);
  expect((await repo.content('fixture-b', 'guide', 'guide-place'))?.revisionId).toBe('r1');
  expect((await repo.plan(t.header.tripId, 'plan-1')).items).toHaveLength(5);
  expect(await repo.list()).toHaveLength(2);
  await expect(
    repo.execute({
      ...cmd,
      payload: { ...(cmd.payload as object), section: { ...guide.payload.sections[2], bodyMd: '다른 요청' } },
    }),
  ).rejects.toThrow('REQUEST_ID_REUSED');
});
it('두 연결의 오래된 쓰기 중 하나만 성공하고 부분 실패 시 영수증/헤더/행을 되돌린다', async () => {
  const { db, repo } = await setup();
  const t = await seed(repo);
  const second = new TravelDB(db.name);
  dbs.push(second);
  const other = new ContentRepository(second);
  const results = await Promise.allSettled([
    repo.execute(
      env(
        t.header.tripId,
        'UpdateTripMetadata',
        { name: 'A', startDate: t.header.startDate, endDate: t.header.endDate },
        0,
      ),
    ),
    other.execute(
      env(
        t.header.tripId,
        'UpdateTripMetadata',
        { name: 'B', startDate: t.header.startDate, endDate: t.header.endDate },
        0,
      ),
    ),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const before = await repo.get(t.header.tripId),
    count = await db.table('command_receipts').count();
  const fail = () => {
    throw new Error('가상 저장 실패');
  };
  db.table('command_receipts').hook('creating', fail);
  await expect(
    repo.execute(
      env(
        t.header.tripId,
        'UpdateTripMetadata',
        { name: '실패', startDate: t.header.startDate, endDate: t.header.endDate },
        1,
      ),
    ),
  ).rejects.toThrow('가상 저장 실패');
  db.table('command_receipts').hook('creating').unsubscribe(fail);
  expect(await repo.get(t.header.tripId)).toEqual(before);
  expect(await db.table('command_receipts').count()).toBe(count);
});
it('계획 제거·미상 실제 기록·정정 후 과거 기록과 맥락을 유지한다', async () => {
  const { repo } = await setup();
  const t = await seed(repo);
  const record = {
    tripId: t.header.tripId,
    recordId: 'actual-added',
    kind: 'actual',
    sourceRefs: [],
    payload: {
      title: '미상 시각 실제',
      targetSummary: '가상',
      outcome: 'skipped',
      time: { start: { precision: 'unspecified' } },
      note: '비',
      planVersionId: 'plan-1',
      activityId: 'activity-1',
      contextRefs: t.plans[0].contextRefs,
    },
  };
  await repo.execute(env(t.header.tripId, 'RecordActual', { record }, 0));
  await repo.execute(
    env(
      t.header.tripId,
      'ChangePlan',
      {
        currentPlanVersionId: 'plan-1',
        operations: [{ type: 'remove-item', activityId: 'activity-1' }],
        reason: '조정',
      },
      1,
    ),
  );
  await repo.execute(
    env(
      t.header.tripId,
      'CorrectActual',
      {
        supersedes: record.recordId,
        record: {
          ...record,
          recordId: 'actual-corrected',
          supersedes: record.recordId,
          payload: { ...record.payload, note: '정정' },
        },
      },
      2,
    ),
  );
  const after = await repo.get(t.header.tripId);
  expect(after.plans[0]).toEqual(t.plans[0]);
  expect(after.records.some((r) => r.recordId === record.recordId)).toBe(true);
  expect(after.records.at(-1)?.supersedes).toBe(record.recordId);
});
it('초안 저장/거절은 도메인 revision을 유지하고 승인/오래된 초안은 재검사한다', async () => {
  const { repo } = await setup();
  const t = await seed(repo);
  const decide = {
    ...env(t.header.tripId, 'DecideProposal', { proposalId: 'proposal-1', decision: 'apply', confirmedByUser: true }),
    expectedProposalRevision: 1,
  };
  await repo.execute(decide);
  expect((await repo.get(t.header.tripId)).header.domainRevision).toBe(1);
  const old = await repo.get(t.header.tripId);
  expect(old.plans).toHaveLength(2);
  expect(old.proposals).toHaveLength(2);
  const { commitSeq: _, ...proposal } = t.proposals[0];
  await repo.execute({
    ...env(t.header.tripId, 'SaveProposal', { proposal: { ...proposal, proposalId: 'late' }, baseDomainRevision: 0 }),
    expectedProposalRevision: 0,
  });
  await expect(
    repo.execute({
      ...decide,
      requestId: 'late-apply',
      payload: { ...(decide.payload as object), proposalId: 'late' },
    }),
  ).rejects.toThrow('CONFLICT');
  await repo.execute({
    ...decide,
    requestId: 'late-reject',
    payload: { proposalId: 'late', decision: 'reject', confirmedByUser: true },
  });
  expect((await repo.get(t.header.tripId)).header.domainRevision).toBe(1);
});
it('기존 승인/실제/영수증을 변환하고 미확인 근거의 수집 시각을 확인일로 승격하지 않는다', async () => {
  const db = new TravelDB(`legacy-rich-${crypto.randomUUID()}`);
  dbs.push(db);
  const legacy = new TravelRepository(db),
    old = demoTrips()[0];
  await legacy.importTrip(old);
  const a = old.versions.at(-1)!.activities[0],
    proposalId = crypto.randomUUID();
  await legacy.propose({
    id: proposalId,
    tripId: old.id,
    baseRevision: old.revision,
    reason: '가상 변경',
    reservationImpact: '영향 없음',
    operations: [{ type: 'upsert', activity: { ...a, title: '승인된 가상 일정' } }],
    evidence: [
      {
        id: 'legacy-evidence',
        source: 'https://example.org/legacy',
        claim: '미확인 가상 근거',
        checkedAt: '2026-10-21T00:00:00Z',
        appliesFrom: old.startDate,
        appliesTo: old.endDate,
        relatedActivityIds: [a.id],
        status: 'unverified',
      },
    ],
  });
  const applied = await legacy.decide(old.id, proposalId, 'apply');
  await legacy.record(old.id, applied.revision, {
    activityId: a.id,
    title: a.title,
    start: a.start,
    end: a.end,
    timeZone: a.timeZone,
    outcome: 'visited',
    note: '보존할 기존 실제',
  });
  const original = await legacy.get(old.id),
    repo = new ContentRepository(db);
  await repo.init();
  await repo.activateLegacy(await repo.prepareLegacy());
  const converted = await repo.get(old.id);
  expect(converted.records[0].payload).toMatchObject({ note: '보존할 기존 실제' });
  expect(converted.proposals.at(-1)?.status).toBe('applied');
  expect(await db.trips.get(old.id)).toEqual(original);
  const evidence = converted.contents.filter(
    (c) => c.kind === 'evidence' && c.payload.sourceUrlOrRef === 'https://example.org/legacy',
  );
  expect(evidence.length).toBeGreaterThan(0);
  for (const row of evidence) {
    if (row.kind === 'evidence') {
      expect(row.payload.sourceVerifiedAt).toBeUndefined();
      expect(row.payload.collectedAt).toBe('2026-10-21T00:00:00Z');
    }
  }
  await expect(
    repo.execute(
      env(
        old.id,
        'UpdateTripMetadata',
        { name: '차단', startDate: old.startDate, endDate: old.endDate },
        original.revision,
        original.receipts[0].id,
      ),
    ),
  ).rejects.toThrow('LEGACY_RECEIPT_UNSUPPORTED');
  const t = await seed(repo);
  for (const stored of await db.table('command_receipts').toArray()) {
    if (stored.fingerprintVersion === 2) {
      const { spaceId: _, ...row } = stored;
      expect(receiptSchema.safeParse(row).success).toBe(true);
    }
  }
  expect(t.header.tripId).toBe('fixture-a');
});
