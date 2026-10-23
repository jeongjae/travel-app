import Dexie, { type IndexableType } from 'dexie';
import { canonicalJson, digestBytes, exchangeCollections, LIMITS } from '../contracts/v2/index.ts';
import { blankRows } from '../transfer/package.ts';
import {
  backupPackageRow,
  backupRowsFingerprint,
  buildBackup,
  readBackup,
  validateBackup,
  type BackupRows,
} from '../transfer/backup.ts';
import { type Workspace } from './schema.ts';
import {
  prepareAssetRecord,
  readAssetRecord,
  discardPreparedFiles,
  retireAssetFiles,
  collectRetiredFiles,
  type AssetRecord,
} from './asset-files.ts';

type Row = Record<string, unknown> & { spaceId: string; tripId: string; commitSeq?: number };
type Asset = AssetRecord;
type Job = {
  jobId: string;
  spaceId: string;
  mode: 'restore';
  status: 'loading' | 'ready' | 'failed' | 'cancelled' | 'succeeded';
  expectedSpace: string;
  expectedSeq: number;
  cutSeq: number;
  tripIds: string[];
  packageDigest: string;
  rowsDigest: string;
  error?: string;
};
type Snapshot = { snapshotId: string; spaceId: string; cutSeq: number; roots: BackupRows };
const roots = ['trip_headers', 'content_heads', 'import_heads', 'proposal_heads'] as const;
const strip = (row: Row) => {
  const { spaceId: _, ...value } = row;
  return value;
};
function assert(ok: unknown, message: string): asserts ok {
  if (!ok) {
    throw new Error(message);
  }
}
const allTables = (db: Dexie) =>
  [
    'workspace_meta',
    'trips',
    ...exchangeCollections,
    'asset_blobs',
    'transfer_jobs',
    'staged_rows',
    'snapshot_jobs',
  ].map((n) => db.table(n));
const meta = async (db: Dexie) => {
  const m = await db.table<Workspace>('workspace_meta').get('workspace');
  if (!m) {
    throw new Error('저장소를 초기화하세요.');
  }
  return m;
};
const spaceRows = (db: Dexie, name: string, space: string) =>
  db.table<Row>(name).where(':id').between([space], [space, Dexie.maxKey], true, true).toArray();
const isEmpty = async (db: Dexie, m: Workspace) =>
  m.mode === 'v2' &&
  (await db.table('trips').count()) === 0 &&
  (await spaceRows(db, 'trip_headers', m.activeSpaceId)).length === 0;
const abort = (signal?: AbortSignal) => signal?.throwIfAborted();

export async function createBackup(
  db: Dexie,
  signal?: AbortSignal,
  onProgress?: (text: string) => void | Promise<void>,
) {
  abort(signal);
  const snapshotId = crypto.randomUUID();
  const snapshot = await db.transaction('rw', allTables(db), async () => {
    const m = await meta(db);
    assert(m.mode === 'v2', '기존 여행을 검토·전환한 후 전체 백업하세요.');
    const fixed = blankRows();
    for (const n of roots) {
      fixed[n] = (await spaceRows(db, n, m.activeSpaceId)).map(strip);
    }
    const s: Snapshot = { snapshotId, spaceId: m.activeSpaceId, cutSeq: m.writeSeq, roots: fixed };
    await db.table('snapshot_jobs').add(s);
    return s;
  });
  try {
    await onProgress?.('백업 기준을 고정했습니다. 이력과 첨부를 확인하는 중입니다.');
    const rows = snapshot.roots,
      tripIds = new Set((rows.trip_headers as { tripId: string }[]).map((h) => h.tripId));
    for (const collection of exchangeCollections) {
      if ((roots as readonly string[]).includes(collection)) {
        continue;
      }
      let last: IndexableType = [snapshot.spaceId];
      while (true) {
        abort(signal);
        const page = await db
          .table<Row>(collection)
          .where(':id')
          .between(last, [snapshot.spaceId, Dexie.maxKey], false, true)
          .limit(200)
          .toArray();
        if (!page.length) {
          break;
        }
        const fields = db.table(collection).schema.primKey.keyPath as string[];
        last = fields.map((f) => page[page.length - 1][f]) as IndexableType;
        for (const r of page) {
          if (tripIds.has(r.tripId) && (r.commitSeq === undefined || r.commitSeq <= snapshot.cutSeq)) {
            rows[collection].push(strip(r));
          }
        }
        if (rows[collection].length > LIMITS.records) {
          throw new Error('백업 레코드 한도 초과.');
        }
      }
    }
    const plans = new Set(
      (rows.plan_versions as { tripId: string; planVersionId: string }[]).map((p) =>
        canonicalJson([p.tripId, p.planVersionId]),
      ),
    );
    for (const n of ['plan_days', 'plan_items', 'plan_legs', 'plan_stays'] as const) {
      rows[n] = rows[n].filter((r) => {
        const p = r as { tripId: string; planVersionId: string };
        return plans.has(canonicalJson([p.tripId, p.planVersionId]));
      });
    }
    rows.import_packages = rows.import_packages.map((r) => backupPackageRow(r));
    const assets = new Map<string, Uint8Array>();
    for (const raw of rows.content_revisions) {
      abort(signal);
      const r = raw as { tripId: string; kind: string; payload: { hash: string; byteLength: number } };
      if (r.kind !== 'asset') {
        continue;
      }
      const a = await db.table<Asset>('asset_blobs').get([snapshot.spaceId, r.tripId, r.payload.hash]);
      const blob = await readAssetRecord(db, a, r.payload.hash, r.payload.byteLength);
      assert(blob, '첨부 바이트가 누락되었거나 해시가 다릅니다. 첨부 복구 후 다시 백업하세요.');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      assets.set(r.payload.hash, bytes);
    }
    abort(signal);
    assert(await db.table('snapshot_jobs').get(snapshotId), '백업 작업이 정리되어 취소했습니다.');
    await onProgress?.('검증한 이력과 첨부를 ZIP으로 만드는 중입니다.');
    const result = await buildBackup(rows, assets, snapshotId, snapshot.cutSeq, signal);
    // Verify the finished artifact through the independent input path before reporting success.
    await readBackup(result.blob, signal);
    assert(await db.table('snapshot_jobs').get(snapshotId), '백업 작업이 정리되어 취소했습니다.');
    return result;
  } finally {
    await db.table('snapshot_jobs').delete(snapshotId);
  }
}

export async function prepareRestore(
  db: Dexie,
  blob: Blob,
  signal?: AbortSignal,
  onProgress?: (text: string) => void | Promise<void>,
) {
  abort(signal);
  const initial = await db.transaction('r', allTables(db), async () => {
    const m = await meta(db);
    assert(await isEmpty(db, m), '전체 복원은 기존 여행이 없는 빈 저장소에서만 가능합니다.');
    return m;
  });
  const backup = await readBackup(blob, signal),
    spaceId = crypto.randomUUID(),
    jobId = crypto.randomUUID();
  const job: Job = {
    jobId,
    spaceId,
    mode: 'restore',
    status: 'loading',
    expectedSpace: initial.activeSpaceId,
    expectedSeq: initial.writeSeq,
    cutSeq: backup.manifest.cutSeq,
    tripIds: backup.manifest.tripIds,
    packageDigest: backup.packageDigest,
    rowsDigest: await backupRowsFingerprint(backup.rows),
  };
  await db.table('transfer_jobs').add(job);
  try {
    for (const n of exchangeCollections) {
      await onProgress?.(`${n} 복원 준비 중입니다.`);
      const values = n === 'import_packages' ? backup.rows[n].map((r) => backupPackageRow(r, true)) : backup.rows[n];
      for (let i = 0; i < values.length; i += 200) {
        abort(signal);
        await db.transaction('rw', [db.table(n), db.table('transfer_jobs')], async () => {
          assert(
            (await db.table<Job>('transfer_jobs').get(jobId))?.status === 'loading',
            '복원 작업이 취소되었습니다.',
          );
          await db.table(n).bulkAdd(values.slice(i, i + 200).map((r) => ({ ...(r as object), spaceId })));
        });
      }
    }
    for (const [sha256, bytes] of backup.assets) {
      abort(signal);
      const trips = new Set(
        (backup.rows.content_revisions as { tripId: string; kind: string; payload: { hash: string } }[])
          .filter((c) => c.kind === 'asset' && c.payload.hash === sha256)
          .map((c) => c.tripId),
      );
      const prepared: AssetRecord[] = [];
      try {
        for (const tripId of trips) {
          prepared.push(await prepareAssetRecord(db, spaceId, tripId, sha256, bytes));
        }
        await db.transaction('rw', [db.table('asset_blobs'), db.table('transfer_jobs')], async () => {
          assert(
            (await db.table<Job>('transfer_jobs').get(jobId))?.status === 'loading',
            '복원 작업이 취소되었습니다.',
          );
          await db.table('asset_blobs').bulkAdd(prepared);
        });
      } finally {
        await discardPreparedFiles(db, prepared);
      }
    }
    abort(signal);
    await db.transaction('rw', db.table('transfer_jobs'), async () => {
      assert((await db.table<Job>('transfer_jobs').get(jobId))?.status === 'loading', '복원 작업이 취소되었습니다.');
      await db.table('transfer_jobs').update(jobId, { status: 'ready' });
    });
    return jobId;
  } catch (e) {
    await db.table('transfer_jobs').update(jobId, {
      status: signal?.aborted ? 'cancelled' : 'failed',
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

export async function activateRestore(db: Dexie, jobId: string, signal?: AbortSignal) {
  abort(signal);
  const job = await db.table<Job>('transfer_jobs').get(jobId);
  assert(job?.mode === 'restore', '복원 작업이 없습니다.');
  if (job.status === 'succeeded') {
    return { status: 'replayed' as const, spaceId: job.spaceId };
  }
  assert(job.status === 'ready', '준비가 완료된 복원만 적용할 수 있습니다.');
  const rows = blankRows();
  for (const n of exchangeCollections) {
    rows[n] = (await spaceRows(db, n, job.spaceId)).map(strip);
  }
  rows.import_packages = rows.import_packages.map((r) => backupPackageRow(r));
  validateBackup(rows, job.tripIds, job.cutSeq);
  assert(
    (await backupRowsFingerprint(rows)) === job.rowsDigest,
    '복원 준비 행의 해시가 변경되었습니다. 원본 백업에서 다시 준비하세요.',
  );
  for (const raw of rows.content_revisions) {
    abort(signal);
    const c = raw as { tripId: string; kind: string; payload: { hash: string; byteLength: number } };
    if (c.kind !== 'asset') {
      continue;
    }
    const a = await db.table<Asset>('asset_blobs').get([job.spaceId, c.tripId, c.payload.hash]);
    assert(await readAssetRecord(db, a, c.payload.hash, c.payload.byteLength), '복원 첨부 재검증 실패.');
  }
  abort(signal);
  return db.transaction('rw', allTables(db), async () => {
    const current = await db.table<Job>('transfer_jobs').get(jobId);
    if (current?.status === 'succeeded') {
      return { status: 'replayed' as const, spaceId: job.spaceId };
    }
    assert(current?.status === 'ready', '복원 작업 상태가 변경되었습니다.');
    const m = await meta(db);
    assert(
      m.activeSpaceId === job.expectedSpace && m.writeSeq === job.expectedSeq && (await isEmpty(db, m)),
      '복원 준비 중 저장소가 변경되었습니다. 기존 여행을 보존하고 복원을 취소합니다.',
    );
    const seq = Math.max(m.writeSeq, job.cutSeq) + 1;
    assert(Number.isSafeInteger(seq), '복원 저장 순번 한도 초과.');
    await db.table<Workspace>('workspace_meta').put({ ...m, activeSpaceId: job.spaceId, writeSeq: seq });
    await db.table('transfer_jobs').update(jobId, { status: 'succeeded' });
    return { status: 'applied' as const, spaceId: job.spaceId };
  });
}

export async function assetStatus(db: Dexie, tripId: string) {
  const snapshot = await db.transaction(
    'r',
    [db.table('workspace_meta'), db.table('content_revisions'), db.table('asset_blobs')],
    async () => {
      const m = await meta(db);
      return {
        contents: await db
          .table<Row>('content_revisions')
          .where('[spaceId+tripId+kind]')
          .equals([m.activeSpaceId, tripId, 'asset'])
          .toArray(),
        assets: await db
          .table<Row>('asset_blobs')
          .where(':id')
          .between([m.activeSpaceId, tripId], [m.activeSpaceId, tripId, Dexie.maxKey], true, true)
          .toArray(),
      };
    },
  );
  const assets = new Map(
    snapshot.assets.filter((a) => a.tripId === tripId).map((a) => [a.sha256 as string, a as unknown as Asset]),
  );
  const result = [];
  const seen = new Set<string>();
  for (const raw of snapshot.contents.filter((c) => c.tripId === tripId && c.kind === 'asset')) {
    const c = raw as unknown as { entityId: string; payload: { hash: string; byteLength: number; title: string } };
    if (seen.has(c.payload.hash)) {
      continue;
    }
    seen.add(c.payload.hash);
    const a = assets.get(c.payload.hash);
    const ready = Boolean(await readAssetRecord(db, a, c.payload.hash, c.payload.byteLength));
    result.push({ hash: c.payload.hash, title: c.payload.title, byteLength: c.payload.byteLength, ready });
  }
  return result;
}
export async function repairAssets(db: Dexie, tripId: string, assets: Map<string, Uint8Array>, signal?: AbortSignal) {
  const m = await meta(db),
    contents = await db
      .table<Row>('content_revisions')
      .where('[spaceId+tripId+kind]')
      .equals([m.activeSpaceId, tripId, 'asset'])
      .toArray();
  const rows: Asset[] = [];
  try {
    for (const [sha256, bytes] of assets) {
      abort(signal);
      const refs = contents.filter(
        (c) => c.tripId === tripId && c.kind === 'asset' && (c.payload as { hash: string }).hash === sha256,
      );
      if (!refs.length) {
        continue;
      }
      assert(
        bytes.length <= LIMITS.assetBytes &&
          refs.every((c) => (c.payload as { byteLength: number }).byteLength === bytes.length) &&
          (await digestBytes(bytes)) === sha256,
        '복구 첨부 크기/해시 불일치.',
      );
      rows.push(await prepareAssetRecord(db, m.activeSpaceId, tripId, sha256, bytes));
    }
    assert(rows.length, '현재 여행의 첨부와 일치하는 파일이 없습니다.');
    abort(signal);
    await db.transaction(
      'rw',
      [db.table('workspace_meta'), db.table('asset_blobs'), db.table('staged_rows')],
      async () => {
        assert((await meta(db)).activeSpaceId === m.activeSpaceId, '저장소가 변경되었습니다.');
        for (const row of rows) {
          const previous = await db.table<Asset>('asset_blobs').get([row.spaceId, row.tripId, row.sha256]);
          if (previous) {
            await retireAssetFiles(db, [previous]);
          }
        }
        await db.table('asset_blobs').bulkPut(rows);
      },
    );
    return rows.length;
  } finally {
    await discardPreparedFiles(db, rows);
  }
}
export async function discardTransfer(db: Dexie, jobId: string) {
  await db.transaction('rw', allTables(db), async () => {
    const job = await db.table('transfer_jobs').get(jobId);
    if (!job) {
      return;
    }
    assert(job.status !== 'succeeded', '완료한 복원은 정리할 수 없습니다.');
    const m = await meta(db);
    if (job.mode === 'restore') {
      assert(job.spaceId !== m.activeSpaceId, '활성 여행을 정리할 수 없습니다.');
      await retireAssetFiles(db, (await spaceRows(db, 'asset_blobs', job.spaceId)) as Asset[]);
      for (const n of [...exchangeCollections, 'asset_blobs']) {
        const table = db.table(n);
        const keys = await table
          .where(':id')
          .between([job.spaceId], [job.spaceId, Dexie.maxKey], true, true)
          .primaryKeys();
        await table.bulkDelete(keys);
      }
    }
    await db.table('staged_rows').where('jobId').equals(jobId).delete();
    await db.table('transfer_jobs').delete(jobId);
  });
  await collectRetiredFiles(db);
}
export async function collectOrphanAssets(db: Dexie) {
  const removed = await db.transaction('rw', allTables(db), async () => {
    const pins = new Set<string>();
    const pin = (space: string, trip: string, hash: string) => pins.add(canonicalJson([space, trip, hash]));
    for (const c of await db.table('content_revisions').toArray()) {
      if (c.kind === 'asset') {
        pin(c.spaceId, c.tripId, c.payload.hash);
      }
    }
    for (const j of await db.table('transfer_jobs').toArray()) {
      for (const c of j.dataset?.contents ?? []) {
        if (c.kind === 'asset') {
          pin(j.spaceId, c.tripId, c.payload.hash);
        }
      }
    }
    let removed = 0;
    for (const a of await db.table<Asset>('asset_blobs').toArray()) {
      if (!pins.has(canonicalJson([a.spaceId, a.tripId, a.sha256]))) {
        await retireAssetFiles(db, [a]);
        await db.table('asset_blobs').delete([a.spaceId, a.tripId, a.sha256]);
        removed++;
      }
    }
    return removed;
  });
  await collectRetiredFiles(db);
  return removed;
}
