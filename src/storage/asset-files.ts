import type Dexie from 'dexie';
import { digestBytes, LIMITS } from '../contracts/v2/index.ts';

export type AssetRecord = {
  spaceId: string;
  tripId: string;
  sha256: string;
  byteLength: number;
  verified: boolean;
  storage?: 'opfs';
  storageKey?: string;
  bytes?: Blob;
};

export interface AssetFileBackend {
  write(key: string, bytes: Uint8Array): Promise<void>;
  read(key: string): Promise<Blob>;
  remove(key: string): Promise<void>;
}

const overrides = new WeakMap<Dexie, AssetFileBackend>();
const retiredJob = 'asset-file-gc';
const retiredCollection = 'asset-files';

// Tests may inject a file system without pretending fake-indexeddb implements OPFS.
export function setAssetFileBackend(db: Dexie, backend: AssetFileBackend) {
  overrides.set(db, backend);
}

function segments(key: string) {
  const parts = key.split('/');
  if (
    parts.length !== 3 ||
    !parts.slice(0, 2).every((part) => /^[a-f0-9]{64}$/.test(part)) ||
    !/^[a-f0-9]{64}-[a-f0-9-]{36}\.bin$/.test(parts[2])
  ) {
    throw new Error('첨부 파일의 논리 경로가 잘못되었습니다.');
  }
  return parts;
}

const opfs: AssetFileBackend = {
  async write(key, bytes) {
    const [database, scope, filename] = segments(key);
    const origin = await navigator.storage.getDirectory();
    const root = await origin.getDirectoryHandle('travel-app-assets-v1', { create: true });
    const databaseFolder = await root.getDirectoryHandle(database, { create: true });
    const folder = await databaseFolder.getDirectoryHandle(scope, { create: true });
    const handle = await folder.getFileHandle(filename, { create: true });
    const stream = await handle.createWritable();
    try {
      await stream.write(new Uint8Array(bytes));
      await stream.close();
    } catch (error) {
      await stream.abort().catch(() => undefined);
      await folder.removeEntry(filename).catch(() => undefined);
      throw error;
    }
  },
  async read(key) {
    const [database, scope, filename] = segments(key);
    const origin = await navigator.storage.getDirectory();
    const root = await origin.getDirectoryHandle('travel-app-assets-v1');
    const databaseFolder = await root.getDirectoryHandle(database);
    const folder = await databaseFolder.getDirectoryHandle(scope);
    return (await folder.getFileHandle(filename)).getFile();
  },
  async remove(key) {
    const [database, scope, filename] = segments(key);
    try {
      const origin = await navigator.storage.getDirectory();
      const root = await origin.getDirectoryHandle('travel-app-assets-v1');
      const databaseFolder = await root.getDirectoryHandle(database);
      const folder = await databaseFolder.getDirectoryHandle(scope);
      await folder.removeEntry(filename);
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'NotFoundError') {
        throw error;
      }
    }
  },
};

function backend(db: Dexie) {
  const selected = overrides.get(db);
  if (selected) {
    return selected;
  }
  if (typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function') {
    return opfs;
  }
  // Node contract tests retain the legacy backend. A real browser must not silently
  // switch new file storage to DB bytes when OPFS is unavailable.
  if (typeof window !== 'undefined') {
    throw new Error('이 브라우저는 앱 전용 이미지 파일 보관을 지원하지 않습니다.');
  }
  return undefined;
}

export async function prepareAssetRecord(
  db: Dexie,
  spaceId: string,
  tripId: string,
  sha256: string,
  bytes: Uint8Array,
): Promise<AssetRecord> {
  if (bytes.length > LIMITS.assetBytes || (await digestBytes(bytes)) !== sha256) {
    throw new Error('첨부 파일 크기/해시가 다릅니다.');
  }
  const common = { spaceId, tripId, sha256, byteLength: bytes.length, verified: true };
  const files = backend(db);
  if (!files) {
    return { ...common, bytes: new Blob([new Uint8Array(bytes)]) };
  }
  const database = await digestBytes(new TextEncoder().encode(db.name));
  const scope = await digestBytes(new TextEncoder().encode(JSON.stringify([spaceId, tripId])));
  // Each write has a new immutable key; repairs never overwrite files held by backups.
  const storageKey = `${database}/${scope}/${sha256}-${crypto.randomUUID()}.bin`;
  try {
    await files.write(storageKey, bytes);
    const saved = await files.read(storageKey);
    if (saved.size !== bytes.length || (await digestBytes(new Uint8Array(await saved.arrayBuffer()))) !== sha256) {
      throw new Error('저장한 첨부 파일을 재검증할 수 없습니다.');
    }
    return { ...common, storage: 'opfs', storageKey };
  } catch (error) {
    await files.remove(storageKey).catch(() => undefined);
    throw error;
  }
}

export async function readAssetRecord(
  db: Dexie,
  record: AssetRecord | undefined,
  hash: string,
  byteLength: number,
): Promise<Blob | undefined> {
  if (!record?.verified || record.sha256 !== hash || record.byteLength !== byteLength) {
    return undefined;
  }
  try {
    const blob =
      record.storage === 'opfs' && record.storageKey ? await backend(db)?.read(record.storageKey) : record.bytes;
    if (blob?.size === byteLength && (await digestBytes(new Uint8Array(await blob.arrayBuffer()))) === hash) {
      return blob;
    }
  } catch {
    // Missing or unreadable files are shown as unprepared; records remain editable.
  }
  return undefined;
}

// Only unpublished files may be removed immediately after an aborted preparation.
export async function discardPreparedFiles(db: Dexie, records: AssetRecord[]) {
  for (const record of records) {
    if (!record.storageKey) {
      continue;
    }
    try {
      const current = await db.table<AssetRecord>('asset_blobs').get([record.spaceId, record.tripId, record.sha256]);
      if (current?.storageKey !== record.storageKey) {
        await backend(db)?.remove(record.storageKey);
      }
    } catch {
      // Cleanup failure must not turn a committed import into a reported failure.
      // The collector rechecks that the file is still unreferenced before retrying.
      await retireAssetFiles(db, [record]).catch(() => undefined);
    }
  }
}

// Called inside the metadata transaction. Deletion is deferred while a backup holds a snapshot.
export async function retireAssetFiles(db: Dexie, records: AssetRecord[]) {
  for (const record of records) {
    if (record.storage === 'opfs' && record.storageKey) {
      await db.table('staged_rows').put({
        jobId: retiredJob,
        collection: retiredCollection,
        rowKey: record.storageKey,
        record,
      });
    }
  }
}

export async function collectRetiredFiles(db: Dexie) {
  const candidates = await db.transaction('r', [db.table('snapshot_jobs'), db.table('staged_rows')], async () => {
    if (await db.table('snapshot_jobs').count()) {
      return [];
    }
    return db.table('staged_rows').where('jobId').equals(retiredJob).toArray();
  });
  let removed = 0;
  for (const candidate of candidates) {
    const record = candidate.record as AssetRecord;
    const current = await db.table<AssetRecord>('asset_blobs').get([record.spaceId, record.tripId, record.sha256]);
    if (current?.storageKey === record.storageKey) {
      continue;
    }
    await backend(db)?.remove(record.storageKey!);
    await db.table('staged_rows').delete([retiredJob, retiredCollection, record.storageKey!]);
    removed++;
  }
  return removed;
}
