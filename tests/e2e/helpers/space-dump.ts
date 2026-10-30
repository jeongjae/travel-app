import type { Page } from '@playwright/test';
import { canonicalJson } from '../../../src/contracts/v2';

/** 검토 공간 저장소(IndexedDB 도메인 행·OPFS 첨부 바이트)를 읽어 복원 전후를 비교하는 시험 도우미. C-06에서 옮겨 C-07도 쓴다. */
// ───────── 저장소 덤프(도메인 행·첨부 바이트) ─────────
export type Dump = {
  tables: Record<string, Record<string, unknown>[]>;
  assets: {
    tripId: string;
    sha256: string;
    byteLength: number;
    verified: boolean;
    actualSha256: string;
    actualSize: number;
  }[];
};
export async function dump(page: Page, review: string): Promise<Dump> {
  return page.evaluate(async (dbName) => {
    const sha = async (bytes: ArrayBuffer) =>
      [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const tables: Record<string, Record<string, unknown>[]> = {};
    const blobs: Record<string, unknown>[] = [];
    for (const name of [...db.objectStoreNames]) {
      const rows = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const read = db.transaction(name).objectStore(name).getAll();
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error);
      });
      if (name === 'asset_blobs') {
        blobs.push(...rows);
      } else {
        tables[name] = rows;
      }
    }
    db.close();
    const assets: Dump['assets'] = [];
    if (!blobs.length) {
      // 첨부가 없는 공간에는 OPFS 첨부 폴더도 아직 없다.
      return { tables, assets };
    }
    const origin = await navigator.storage.getDirectory();
    const root = await origin.getDirectoryHandle('travel-app-assets-v1');
    for (const row of blobs as {
      tripId: string;
      sha256: string;
      byteLength: number;
      verified: boolean;
      storageKey?: string;
      bytes?: Blob;
    }[]) {
      let buffer: ArrayBuffer;
      if (row.storageKey) {
        const [database, scope, filename] = row.storageKey.split('/');
        const folder = await (await root.getDirectoryHandle(database)).getDirectoryHandle(scope);
        buffer = await (await (await folder.getFileHandle(filename)).getFile()).arrayBuffer();
      } else {
        buffer = await row.bytes!.arrayBuffer();
      }
      assets.push({
        tripId: row.tripId,
        sha256: row.sha256,
        byteLength: row.byteLength,
        verified: row.verified,
        actualSha256: await sha(buffer),
        actualSize: buffer.byteLength,
      });
    }
    return { tables, assets };
  }, `travel-app-review-${review}`);
}
/** 도메인 행만 비교한다. spaceId와 복원 작업 메타(transfer/staged/snapshot/workspace_meta)는 의도된 차이다. */
export const DOMAIN_TABLES = [
  'trip_headers',
  'content_heads',
  'content_revisions',
  'plan_versions',
  'plan_days',
  'plan_items',
  'plan_legs',
  'plan_stays',
  'field_records',
  'import_packages',
  'import_heads',
  'import_mappings',
  'proposal_heads',
  'proposal_revisions',
  'command_receipts',
] as const;
export function domain(d: Dump, tripId?: string) {
  const out: Record<string, string[]> = {};
  for (const name of DOMAIN_TABLES) {
    out[name] = (d.tables[name] ?? [])
      .filter((row) => !tripId || row.tripId === tripId)
      .map((row) => {
        const { spaceId: _spaceId, ...rest } = row;
        return canonicalJson(rest);
      })
      .sort();
  }
  return out;
}
export const counts = (d: Dump) =>
  Object.fromEntries(DOMAIN_TABLES.map((name) => [name, (d.tables[name] ?? []).length]));
export const tripIdOf = (d: Dump, name: string) =>
  (d.tables.trip_headers.find((h) => (h as { name?: string }).name === name) as { tripId: string }).tripId;
export const spaceIds = (d: Dump) =>
  new Set(DOMAIN_TABLES.flatMap((name) => (d.tables[name] ?? []).map((row) => row.spaceId)));
