import { afterEach, expect, it } from 'vitest';
import { ContentRepository, TravelDB } from '../src/repository';
import { canonicalJson, digestBytes } from '../src/contracts/v2';
import { pilotTrip, fixtureAssets } from './fixtures/pilot';
import { currentMappings } from '../src/transfer/normalize';
import { readBackup, validateBackup } from '../src/transfer/backup';
import { legacyCanonical } from '../src/storage/legacy';
import { demoTrips } from '../src/demo';
const dbs: TravelDB[] = [];
afterEach(async () => {
  for (const db of dbs.splice(0)) {
    db.close();
    await db.delete();
  }
});
async function setup() {
  const db = new TravelDB(`recovery-${crypto.randomUUID()}`);
  dbs.push(db);
  const repo = new ContentRepository(db);
  await repo.init();
  return { db, repo };
}
const command = (tripId: string, kind: string, payload: unknown, expectedDomainRevision?: number) => ({
  format: 'travel-app-command',
  commandVersion: 2,
  normalizationVersion: 'neutral-v1',
  tripId,
  requestId: crypto.randomUUID(),
  kind,
  payload,
  ...(expectedDomainRevision === undefined ? {} : { expectedDomainRevision }),
});
async function seed(repo: ContentRepository, short = false) {
  const t = await pilotTrip(short),
    assets = new Map<string, Uint8Array>();
  for (const b of Object.values(fixtureAssets)) assets.set(await digestBytes(b), b);
  const provenance = {
    packageId: crypto.randomUUID(),
    packageDigest: 'a'.repeat(64),
    lineageId: 'synthetic',
    adapterVersion: '1',
    manifest: {},
    report: {},
    mappings: currentMappings(t),
  };
  await repo.prepareImport(t, assets, provenance);
  await repo.execute(
    command(t.header.tripId, 'ImportNewTrip', {
      packageId: provenance.packageId,
      packageDigest: provenance.packageDigest,
    }),
  );
  return { t, assets };
}
async function edit(repo: ContentRepository, tripId = 'fixture-a') {
  const g = await repo.content(tripId, 'guide', 'guide-place');
  if (g?.kind !== 'guide') throw new Error('guide');
  const header = (await repo.get(tripId)).header;
  const c = command(
    tripId,
    'EditContentSection',
    {
      target: { targetKind: 'guide', entityId: g.entityId, revisionId: g.revisionId },
      section: { ...g.payload.sections[2], bodyMd: '백업 중 편집한 본문 {{fact:opening}}' },
    },
    header.domainRevision,
  );
  const result = await repo.execute(c);
  return { c, result };
}
it('편집 중에도 cutSeq의 두 여행·포인터·이력·B·영수증만 백업하고 원본은 계속 편집된다', async () => {
  const { repo, db } = await setup();
  await seed(repo);
  await seed(repo, true);
  const before = await repo.get('fixture-a'),
    cut = (await repo.meta()).writeSeq;
  let changed = false;
  const backup = await repo.createBackup(undefined, async () => {
    if (!changed) {
      changed = true;
      await edit(repo);
      await repo.execute(
        command(
          'fixture-a',
          'ChangePlan',
          {
            currentPlanVersionId: before.header.currentPlanVersionId,
            operations: [{ type: 'remove-item', activityId: before.plans[0].items[0].activityId }],
            reason: '백업 중 새 계획',
          },
          1,
        ),
      );
    }
  });
  const decoded = await readBackup(backup.blob);
  expect(decoded.manifest.cutSeq).toBe(cut);
  expect(decoded.manifest.tripIds).toHaveLength(2);
  expect(decoded.rows.content_revisions.filter((r) => (r as { tripId: string }).tripId === 'fixture-a')).toHaveLength(
    before.contents.length,
  );
  expect((await repo.get('fixture-a')).contents).toHaveLength(before.contents.length + 1);
  expect(await db.table('snapshot_jobs').count()).toBe(0);
  const target = await setup();
  const job = await target.repo.prepareRestore(backup.blob);
  expect(await target.repo.list()).toEqual([]);
  await target.repo.activateRestore(job);
  expect(canonicalJson(await target.repo.get('fixture-a'))).toBe(canonicalJson(before));
});
it('빈 저장소 복원은 모든 이력·초안·B와 명령 결과 replay를 보존하고 다음 순번을 올린다', async () => {
  const source = await setup();
  await seed(source.repo);
  await seed(source.repo, true);
  const saved = await edit(source.repo),
    expected = await source.repo.get('fixture-a'),
    backup = await source.repo.createBackup();
  const { repo, db } = await setup();
  const start = await repo.meta(),
    job = await repo.prepareRestore(backup.blob);
  expect((await repo.meta()).activeSpaceId).toBe(start.activeSpaceId);
  expect(await repo.list()).toHaveLength(0);
  const first = await repo.activateRestore(job);
  expect(first.status).toBe('applied');
  expect((await repo.activateRestore(job)).status).toBe('replayed');
  expect(canonicalJson(await repo.get('fixture-a'))).toBe(canonicalJson(expected));
  expect(await repo.execute(saved.c)).toEqual({ ...saved.result, status: 'replayed' });
  expect((await repo.meta()).writeSeq).toBeGreaterThan(backup.manifest.cutSeq);
  const seq = (await repo.meta()).writeSeq;
  await repo.execute(
    command(
      'fixture-a',
      'AddNote',
      {
        record: {
          tripId: 'fixture-a',
          recordId: 'restored-note',
          kind: 'note',
          sourceRefs: [],
          payload: {
            targetRef: { tripId: 'fixture-a', targetKind: 'trip', entityId: 'fixture-a' },
            body: '복원 후 기록',
            contextRefs: [],
          },
        },
      },
      expected.header.domainRevision,
    ),
  );
  expect((await repo.meta()).writeSeq).toBe(seq + 1);
  expect(await db.table('snapshot_jobs').count()).toBe(0);
});
it('기존 데이터 및 복원 준비 중 새 여행이 생기면 활성화를 거부한다', async () => {
  const s = await setup();
  await seed(s.repo);
  const backup = await s.repo.createBackup();
  await expect(s.repo.prepareRestore(backup.blob)).rejects.toThrow('빈 저장소');
  const { repo, db } = await setup(),
    job = await repo.prepareRestore(backup.blob),
    original = await repo.meta();
  await seed(repo, true);
  await expect(repo.activateRestore(job)).rejects.toThrow('변경');
  expect((await repo.meta()).activeSpaceId).toBe(original.activeSpaceId);
  expect((await repo.list()).map((t) => t.tripId)).toEqual(['fixture-b']);
  await repo.discardTransfer(job);
  expect((await repo.list()).map((t) => t.tripId)).toEqual(['fixture-b']);
  expect(await db.table('transfer_jobs').get(job)).toBeUndefined();
});
it('복원 중 취소·재시작은 반쪽 여행을 노출하지 않고 명시적으로 정리할 수 있다', async () => {
  const s = await setup();
  await seed(s.repo);
  const backup = await s.repo.createBackup();
  const { repo, db } = await setup(),
    controller = new AbortController(),
    before = await repo.meta();
  await expect(
    repo.prepareRestore(backup.blob, controller.signal, (text) => {
      if (text.startsWith('content_revisions')) controller.abort();
    }),
  ).rejects.toThrow();
  expect(await repo.list()).toEqual([]);
  expect((await repo.meta()).activeSpaceId).toBe(before.activeSpaceId);
  db.close();
  await db.open();
  const pending = await repo.pendingTransfers();
  expect(pending).toHaveLength(1);
  expect(pending[0].status).toBe('cancelled');
  await repo.discardTransfer(pending[0].jobId);
  expect(await repo.pendingTransfers()).toEqual([]);
  expect(await db.table('content_heads').count()).toBe(0);
  const job = await repo.prepareRestore(backup.blob);
  db.close();
  await db.open();
  await repo.activateRestore(job);
  expect(await repo.list()).toHaveLength(1);
});
it('공간 부족과 활성화 저장 실패는 성공으로 보고하지 않고 원본/활성 영역을 보존한다', async () => {
  const source = await setup();
  await seed(source.repo);
  const backup = await source.repo.createBackup(),
    { repo, db } = await setup(),
    before = await repo.meta();
  const quota = () => {
    throw new DOMException('가상 공간 부족', 'QuotaExceededError');
  };
  db.table('asset_blobs').hook('creating', quota);
  await expect(repo.prepareRestore(backup.blob)).rejects.toThrow('공간 부족');
  db.table('asset_blobs').hook('creating').unsubscribe(quota);
  expect(await repo.list()).toEqual([]);
  expect(await repo.meta()).toEqual(before);
  for (const j of await repo.pendingTransfers()) await repo.discardTransfer(j.jobId);
  const job = await repo.prepareRestore(backup.blob),
    failure = () => {
      throw new Error('주입 활성화 실패');
    };
  db.table('workspace_meta').hook('updating', failure);
  await expect(repo.activateRestore(job)).rejects.toThrow('주입');
  db.table('workspace_meta').hook('updating').unsubscribe(failure);
  expect(await repo.meta()).toEqual(before);
  expect((await repo.pendingTransfers())[0].status).toBe('ready');
  await repo.activateRestore(job);
});
it('첨부 축출·손상은 감지하고 현장 기록을 허용하며 백업은 차단하고 해시 일치 바이트로 복구한다', async () => {
  const { repo, db } = await setup(),
    { assets } = await seed(repo),
    m = await repo.meta();
  const hash = [...assets.keys()][0];
  await db.table('asset_blobs').delete([m.activeSpaceId, 'fixture-a', hash]);
  expect((await repo.assetStatus('fixture-a')).some((a) => !a.ready)).toBe(true);
  await expect(repo.createBackup()).rejects.toThrow('누락');
  const t = await repo.get('fixture-a');
  await repo.execute(
    command(
      'fixture-a',
      'AddNote',
      {
        record: {
          tripId: 'fixture-a',
          recordId: 'offline-note',
          kind: 'note',
          sourceRefs: [],
          payload: {
            targetRef: { tripId: 'fixture-a', targetKind: 'trip', entityId: 'fixture-a' },
            body: '첨부 없이 기록',
            contextRefs: [],
          },
        },
      },
      t.header.domainRevision,
    ),
  );
  const after = await repo.meta();
  expect(await repo.repairAssets('fixture-a', assets)).toBe(assets.size);
  expect(await repo.meta()).toEqual(after);
  expect((await repo.assetStatus('fixture-a')).every((a) => a.ready)).toBe(true);
  const row = await db.table('asset_blobs').get([m.activeSpaceId, 'fixture-a', hash]);
  await db.table('asset_blobs').put({ ...row, bytes: new Blob([new Uint8Array(row.byteLength)]) });
  expect((await repo.assetStatus('fixture-a')).some((a) => !a.ready)).toBe(true);
  await expect(repo.createBackup()).rejects.toThrow('해시');
  await repo.repairAssets('fixture-a', assets);
  await repo.createBackup();
});
it('참조 없는 첨부만 정리하고 현재·과거·준비 작업이 필요한 첨부는 보존한다', async () => {
  const { repo, db } = await setup();
  await seed(repo);
  const m = await repo.meta(),
    before = await db.table('asset_blobs').count();
  await db.table('asset_blobs').add({
    spaceId: m.activeSpaceId,
    tripId: 'fixture-a',
    sha256: 'f'.repeat(64),
    bytes: new Blob(['orphan']),
    byteLength: 6,
    verified: true,
  });
  expect(await repo.collectOrphanAssets()).toBe(1);
  expect(await db.table('asset_blobs').count()).toBe(before);
  for (const j of await repo.pendingTransfers()) await repo.discardTransfer(j.jobId);
  expect(await repo.collectOrphanAssets()).toBe(0);
  expect(await db.table('asset_blobs').count()).toBe(before);
});
it('중복 행·cutSeq 초과·고아 B/영수증 참조·숨겨진 영역 변조를 거부한다', async () => {
  const s = await setup();
  await seed(s.repo);
  await edit(s.repo);
  const backup = await s.repo.createBackup(),
    decoded = await readBackup(backup.blob);
  const check = (mutate: (r: typeof decoded.rows) => void) => {
    const rows = structuredClone(decoded.rows);
    mutate(rows);
    expect(() => validateBackup(rows, decoded.manifest.tripIds, decoded.manifest.cutSeq)).toThrow();
  };
  check((r) => r.content_heads.push(r.content_heads[0]));
  check((r) => ((r.content_revisions[0] as { commitSeq: number }).commitSeq = decoded.manifest.cutSeq + 1));
  check((r) => ((r.import_heads[0] as { mappingRevisionId: string }).mappingRevisionId = 'missing'));
  check((r) => {
    const receipt = r.command_receipts.find(
      (r) => (r as { result: { resultRefs: unknown[] } }).result.resultRefs.length,
    ) as { result: { resultRefs: { id: string }[] } };
    receipt.result.resultRefs[0].id = 'missing';
  });
  const { repo, db } = await setup(),
    job = await repo.prepareRestore(backup.blob),
    pending = await db.table('transfer_jobs').get(job);
  const row = await db
    .table('content_heads')
    .where(':id')
    .between([pending.spaceId], [pending.spaceId, '\uffff'])
    .first();
  await db.table('content_heads').put({ ...row, revisionId: 'missing' });
  await expect(repo.activateRestore(job)).rejects.toThrow();
  expect(await repo.list()).toEqual([]);
});
it('전환한 v1의 명시적 undefined 원문·차단 영수증도 손실 없이 백업/복원한다', async () => {
  const { repo, db } = await setup();
  await db.delete();
  await db.open();
  const original = demoTrips()[0];
  original.versions[0].activities[0].placeId = undefined;
  await db.trips.add(original);
  await repo.init();
  await repo.activateLegacy(await repo.prepareLegacy());
  const before = await repo.get(original.id),
    backup = await repo.createBackup();
  const target = await setup(),
    job = await target.repo.prepareRestore(backup.blob);
  await target.repo.activateRestore(job);
  expect(canonicalJson(await target.repo.get(original.id))).toBe(canonicalJson(before));
  const sourcePackage = (await db.table('import_packages').toArray())[0],
    restored = (await target.db.table('import_packages').toArray())[0];
  expect(legacyCanonical(restored.report.original)).toBe(legacyCanonical(sourcePackage.report.original));
});
it('백업 취소는 snapshot pin을 해제하고 활성 데이터/순번을 변경하지 않는다', async () => {
  const { repo, db } = await setup();
  await seed(repo);
  const before = await repo.meta(),
    controller = new AbortController();
  await expect(repo.createBackup(controller.signal, () => controller.abort())).rejects.toThrow();
  expect(await repo.meta()).toEqual(before);
  expect(await db.table('snapshot_jobs').count()).toBe(0);
});
it('200행 경계를 넘는 이력을 빠짐없이 복원하고 동시에 활성화해도 한 번만 전환한다', async () => {
  const { repo } = await setup();
  const { t, assets } = await seed(repo);
  const dataset = await repo.get(t.header.tripId);
  const source = await setup();
  const clone = structuredClone(t);
  for (let i = 0; i < 405; i++)
    clone.records.push({
      tripId: t.header.tripId,
      recordId: `page-note-${i}`,
      kind: 'note',
      recordedAt: '2026-10-22T00:00:00Z',
      commitSeq: i + 20,
      sourceRefs: [],
      payload: {
        targetRef: { tripId: t.header.tripId, targetKind: 'trip', entityId: t.header.tripId },
        body: `페이지 경계 ${i}`,
        contextRefs: [],
      },
    });
  const prov = {
    packageId: 'paged-source',
    packageDigest: 'b'.repeat(64),
    lineageId: 'synthetic',
    adapterVersion: '1',
    manifest: {},
    report: {},
    mappings: currentMappings(clone),
  };
  await source.repo.prepareImport(clone, assets, prov);
  await source.repo.execute(
    command(t.header.tripId, 'ImportNewTrip', { packageId: prov.packageId, packageDigest: prov.packageDigest }),
  );
  const backup = await source.repo.createBackup(),
    target = await setup(),
    job = await target.repo.prepareRestore(backup.blob);
  const results = await Promise.all([target.repo.activateRestore(job), target.repo.activateRestore(job)]);
  expect(results.map((r) => r.status).sort()).toEqual(['applied', 'replayed']);
  expect((await target.repo.timeline(t.header.tripId)).length).toBe(dataset.records.length + 405);
});
it('스키마상 유효한 staging 변조와 중단된 snapshot의 정리를 감지한다', async () => {
  const s = await setup();
  await seed(s.repo);
  const backup = await s.repo.createBackup(),
    target = await setup(),
    jobId = await target.repo.prepareRestore(backup.blob),
    job = await target.db.table('transfer_jobs').get(jobId);
  await target.db.table('trip_headers').update([job.spaceId, 'fixture-a'], { name: '임의로 바뀐 여행' });
  await expect(target.repo.activateRestore(jobId)).rejects.toThrow('해시');
  expect(await target.repo.list()).toEqual([]);
  await expect(
    s.repo.createBackup(undefined, async () => {
      for (const snap of await s.repo.pendingSnapshots()) await s.repo.discardSnapshot(snap.snapshotId);
    }),
  ).rejects.toThrow('정리');
  expect(await s.repo.pendingSnapshots()).toEqual([]);
  expect(await s.repo.list()).toHaveLength(1);
});
