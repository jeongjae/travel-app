import { afterEach, expect, it } from 'vitest';
import { ContentRepository, TravelDB } from '../src/repository';
import { digestBytes } from '../src/contracts/v2';
import { currentMappings } from '../src/transfer/normalize';
import { readBackup } from '../src/transfer/backup';
import { setAssetFileBackend, type AssetFileBackend, type AssetRecord } from '../src/storage/asset-files';
import { fixtureAssets, pilotTrip } from './fixtures/pilot';

class Files implements AssetFileBackend {
  values = new Map<string, Blob>();
  failAfter = Infinity;

  async write(key: string, bytes: Uint8Array) {
    if (this.values.size >= this.failAfter) {
      throw new DOMException('가상 파일 저장 공간 부족', 'QuotaExceededError');
    }
    this.values.set(key, new Blob([new Uint8Array(bytes)]));
  }

  async read(key: string) {
    const value = this.values.get(key);
    if (!value) {
      throw new DOMException('가상 파일 누락', 'NotFoundError');
    }
    return value;
  }

  async remove(key: string) {
    this.values.delete(key);
  }
}

const databases: TravelDB[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) {
    db.close();
    await db.delete();
  }
});

async function setup() {
  const db = new TravelDB(`asset-file-${crypto.randomUUID()}`);
  databases.push(db);
  const files = new Files();
  setAssetFileBackend(db, files);
  const repo = new ContentRepository(db);
  await repo.init();
  return { db, files, repo };
}

async function input() {
  const dataset = await pilotTrip();
  const assets = new Map<string, Uint8Array>();
  for (const bytes of Object.values(fixtureAssets)) {
    assets.set(await digestBytes(bytes), bytes);
  }
  const provenance = {
    packageId: crypto.randomUUID(),
    packageDigest: 'a'.repeat(64),
    lineageId: 'fictional-files',
    adapterVersion: '1',
    manifest: {},
    report: {},
    mappings: currentMappings(dataset),
  };
  return { dataset, assets, provenance };
}

async function seed(repo: ContentRepository) {
  const data = await input();
  await repo.prepareImport(data.dataset, data.assets, data.provenance);
  await repo.execute({
    format: 'travel-app-command',
    commandVersion: 2,
    normalizationVersion: 'neutral-v1',
    requestId: crypto.randomUUID(),
    tripId: data.dataset.header.tripId,
    kind: 'ImportNewTrip',
    payload: { packageId: data.provenance.packageId, packageDigest: data.provenance.packageDigest },
  });
  return data;
}

it('첨부 바이트는 파일에 두고 DB에는 참조만 저장하며 백업을 다른 빈 파일 저장소에 복원한다', async () => {
  const source = await setup();
  const data = await seed(source.repo);
  const rows = await source.db.table<AssetRecord>('asset_blobs').toArray();
  expect(rows).toHaveLength(2);
  expect(rows.every((row) => row.storage === 'opfs' && row.storageKey && row.bytes === undefined)).toBe(true);
  expect((await source.repo.asset(data.dataset.header.tripId, 'asset-image'))?.blob.type).toBe('image/png');
  const backup = await source.repo.createBackup();
  expect((await readBackup(backup.blob)).assets.size).toBe(2);
  const target = await setup();
  const job = await target.repo.prepareRestore(backup.blob);
  expect(await target.repo.list()).toEqual([]);
  await target.repo.activateRestore(job);
  expect((await target.repo.asset(data.dataset.header.tripId, 'asset-image'))?.blob.size).toBe(
    fixtureAssets['asset-image'].length,
  );
  expect((await target.db.table<AssetRecord>('asset_blobs').toArray()).every((row) => !row.bytes)).toBe(true);
});

it('파일 쓰기·DB 트랜잭션 실패는 여행과 첨부 참조를 노출하지 않고 준비 파일을 정리한다', async () => {
  for (const failure of ['file', 'database']) {
    const target = await setup();
    const data = await input();
    const quota = () => {
      throw new DOMException('가상 DB 공간 부족', 'QuotaExceededError');
    };
    if (failure === 'file') {
      target.files.failAfter = 1;
    } else {
      target.db.table('transfer_jobs').hook('creating', quota);
    }
    await expect(target.repo.prepareImport(data.dataset, data.assets, data.provenance)).rejects.toThrow('공간 부족');
    expect(await target.repo.list()).toEqual([]);
    expect(await target.db.table('asset_blobs').count()).toBe(0);
    expect(await target.db.table('transfer_jobs').count()).toBe(0);
    expect(target.files.values.size).toBe(0);
  }
});

it('백업 중 복구는 새 파일을 만들고 스냅샷이 끝나기 전의 파일 정리를 보류한다', async () => {
  const source = await setup();
  const data = await seed(source.repo);
  const oldKeys = new Set(source.files.values.keys());
  let repaired = false;
  const backup = await source.repo.createBackup(undefined, async () => {
    if (!repaired) {
      repaired = true;
      await source.repo.repairAssets(data.dataset.header.tripId, data.assets);
      await source.repo.collectOrphanAssets();
      expect([...oldKeys].every((key) => source.files.values.has(key))).toBe(true);
      expect(source.files.values.size).toBe(4);
    }
  });
  expect((await readBackup(backup.blob)).assets.size).toBe(2);
  await source.repo.collectOrphanAssets();
  expect([...oldKeys].every((key) => !source.files.values.has(key))).toBe(true);
  expect(source.files.values.size).toBe(2);
});

it('파일 유실은 준비 실패로 표시하고 복원 활성화 직전에 파일 해시를 다시 검사한다', async () => {
  const source = await setup();
  const data = await seed(source.repo);
  const backup = await source.repo.createBackup();
  source.files.values.clear();
  expect((await source.repo.assetStatus(data.dataset.header.tripId)).every((asset) => !asset.ready)).toBe(true);
  await expect(source.repo.createBackup()).rejects.toThrow('첨부');
  await source.repo.repairAssets(data.dataset.header.tripId, data.assets);
  expect((await source.repo.assetStatus(data.dataset.header.tripId)).every((asset) => asset.ready)).toBe(true);
  const target = await setup();
  const job = await target.repo.prepareRestore(backup.blob);
  const key = [...target.files.values.keys()][0];
  target.files.values.set(key, new Blob(['손상된 가상 파일']));
  await expect(target.repo.activateRestore(job)).rejects.toThrow('첨부');
  expect(await target.repo.list()).toEqual([]);
  await target.repo.discardTransfer(job);
  expect(target.files.values.size).toBe(0);
});
