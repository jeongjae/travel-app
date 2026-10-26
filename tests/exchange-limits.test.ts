import { afterEach, expect, it } from 'vitest';
import { BlobReader, BlobWriter, Uint8ArrayReader, ZipReader, ZipWriter } from '@zip.js/zip.js';
import { ContentRepository, TravelDB } from '../src/repository';
import { canonicalJson, digestBytes, LIMITS } from '../src/contracts/v2';
import { buildBackup, readBackup } from '../src/transfer/backup';
import { currentMappings } from '../src/transfer/normalize';
import { command } from '../src/content/ui';
import { fixtureAssets, pilotTrip } from './fixtures/pilot';

const databases: TravelDB[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) {
    await database.delete();
  }
});

async function setup() {
  const database = new TravelDB(`exchange-boundary-${crypto.randomUUID()}`);
  databases.push(database);
  const repository = new ContentRepository(database);
  await repository.init();
  return { database, repository };
}

async function source() {
  const { repository } = await setup();
  const dataset = await pilotTrip();
  const assets = new Map<string, Uint8Array>();
  for (const bytes of Object.values(fixtureAssets)) {
    assets.set(await digestBytes(bytes), bytes);
  }
  const provenance = {
    packageId: 'fictional-limits',
    packageDigest: 'b'.repeat(64),
    lineageId: 'fictional-limits',
    adapterVersion: '1',
    manifest: {},
    report: {},
    mappings: currentMappings(dataset),
  };
  await repository.prepareImport(dataset, assets, provenance);
  await repository.execute(
    command(dataset.header.tripId, 'ImportNewTrip', {
      packageId: provenance.packageId,
      packageDigest: provenance.packageDigest,
    }),
  );
  const archive = await repository.createBackup();
  return readBackup(archive.blob);
}

async function exceedArchive(blob: Blob, path: string, bytes: Uint8Array) {
  const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false });
  const entries = await reader.getEntries();
  const files = new Map<string, Uint8Array>();
  try {
    for (const entry of entries) {
      if (entry.directory) {
        continue;
      }
      files.set(
        entry.filename,
        await entry.getData(new BlobWriter()).then(async (blob) => new Uint8Array(await blob.arrayBuffer())),
      );
    }
  } finally {
    await reader.close();
  }
  const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')));
  const changed = manifest.files.find((file: { path: string }) => file.path === path);
  changed.byteLength = bytes.length;
  changed.sha256 = await digestBytes(bytes);
  files.set(path, bytes);
  files.set('manifest.json', new TextEncoder().encode(canonicalJson(manifest)));
  const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false });
  for (const [name, value] of files) {
    await writer.add(name, new Uint8ArrayReader(value));
  }
  return writer.close();
}

it.each(['content_revisions', 'import_packages'] as const)(
  '%s의 정확한 UTF-8 행 한도는 복원하고 1바이트 초과는 송수신 양쪽에서 거부한다',
  async (collection) => {
    const backup = await source();
    const row = backup.rows[collection].find(
      (row) => collection === 'import_packages' || (row as { kind: string }).kind === 'guide',
    ) as Record<string, unknown>;
    let base = '';
    let set: (value: string) => void;
    if (collection === 'import_packages') {
      row.report = { padding: '' };
      set = (value) => {
        (row.report as { padding: string }).padding = value;
      };
    } else {
      const section = (row.payload as { sections: { bodyMd: string }[] }).sections[0];
      base = section.bodyMd;
      set = (value) => {
        section.bodyMd = value;
      };
    }
    const limit = collection === 'import_packages' ? LIMITS.provenanceBytes : LIMITS.recordBytes;
    const gap = limit - new TextEncoder().encode(canonicalJson(row)).length;
    const padding = '가'.repeat(Math.floor(gap / 3)) + 'x'.repeat(gap % 3);
    set(base + padding);
    expect(new TextEncoder().encode(canonicalJson(row))).toHaveLength(limit);
    const archive = await buildBackup(backup.rows, backup.assets, 'exact-byte-boundary', backup.manifest.cutSeq);
    const restored = await readBackup(archive.blob);
    expect(restored.rows[collection]).toEqual(backup.rows[collection]);
    const destination = await setup();
    await destination.repository.activateRestore(await destination.repository.prepareRestore(archive.blob));
    expect((await destination.repository.list())[0].tripId).toBe(backup.manifest.tripIds[0]);
    const before = await destination.repository.meta();
    set(base + padding + 'x');
    await expect(buildBackup(backup.rows, backup.assets, 'one-byte-over', backup.manifest.cutSeq)).rejects.toThrow(
      '단일 행 한도',
    );
    const bytes = new TextEncoder().encode(backup.rows[collection].map((row) => canonicalJson(row) + '\n').join(''));
    const oversized = await exceedArchive(archive.blob, `records/${collection}.ndjson`, bytes);
    await expect(readBackup(oversized)).rejects.toThrow('한도');
    await expect(destination.repository.prepareRestore(oversized)).rejects.toThrow('빈 저장소');
    expect(await destination.repository.meta()).toEqual(before);
    const empty = await setup();
    const originalSpace = await empty.repository.meta();
    await expect(empty.repository.prepareRestore(oversized)).rejects.toThrow('한도');
    expect(await empty.repository.meta()).toEqual(originalSpace);
    expect(await empty.repository.list()).toEqual([]);
  },
  30000,
);
