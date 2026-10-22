import { BlobReader, BlobWriter, Uint8ArrayReader, ZipReader, ZipWriter } from '@zip.js/zip.js';
import { z } from 'zod';
import {
  canonicalJson,
  digestBytes,
  exchangeCollections,
  LIMITS,
  manifestSchema,
  parseManifestJson,
  parseStrictJson,
  validateManifestPaths,
  validateTripDataset,
  contentRevisionSchema,
  contentHeadSchema,
  fieldRecordSchema,
  planVersionSchema,
  planDaySchema,
  planItemSchema,
  planLegSchema,
  planStaySchema,
  proposalSchema,
  sourceRef,
  tripHeaderSchema,
  id,
  contentKind,
  type TripDataset,
} from '../contracts/v2/index.ts';
import { currentMappings } from './normalize.ts';
import type { Provenance, ImportMapping } from '../storage/content-repository.ts';
const encode = (value: string) => new TextEncoder().encode(value);
const decode = (bytes: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const mappingSchema = z.strictObject({
  sourceKind: z.string().min(1),
  sourceKey: z.string().min(1),
  targetKind: z.enum([...contentKind.options, 'plan', 'trip']),
  entityId: id,
  baselineValue: z.json(),
  sourceRefs: z.array(sourceRef),
});
const reportSchema = z.strictObject({
  report: z.json(),
  mappings: z.array(mappingSchema),
  blocking: z.array(z.string()),
});
const planParentSchema = planVersionSchema.omit({ days: true, items: true, legs: true, stays: true });
export type Collection = (typeof exchangeCollections)[number];
export function blankRows() {
  const rows = {} as Record<Collection, unknown[]>;
  for (const n of exchangeCollections) {
    rows[n] = [];
  }
  return rows;
}
export function datasetRows(t: TripDataset): Record<Collection, unknown[]> {
  const out = blankRows();
  out.trip_headers = [t.header];
  out.content_heads = t.heads;
  out.content_revisions = t.contents;
  out.field_records = t.records;
  out.proposal_revisions = t.proposals;
  for (const p of t.plans) {
    const { days, items, legs, stays, ...parent } = p;
    out.plan_versions.push(parent);
    out.plan_days.push(...days);
    out.plan_items.push(...items);
    out.plan_legs.push(...legs);
    out.plan_stays.push(...stays);
  }
  return out;
}
export function rowsDataset(rows: Record<Collection, unknown[]>): TripDataset {
  if (rows.trip_headers.length !== 1) {
    throw new Error('한 패키지에는 한 여행 헤더가 필요합니다.');
  }
  const parents = rows.plan_versions.map((r) => planParentSchema.parse(r)),
    days = rows.plan_days.map((r) => planDaySchema.parse(r)),
    items = rows.plan_items.map((r) => planItemSchema.parse(r)),
    legs = rows.plan_legs.map((r) => planLegSchema.parse(r)),
    stays = rows.plan_stays.map((r) => planStaySchema.parse(r));
  const known = new Set(parents.map((p) => p.planVersionId));
  for (const r of [...days, ...items, ...legs, ...stays]) {
    if (!known.has(r.planVersionId)) {
      throw new Error('고아 계획 자식 행입니다.');
    }
  }
  return validateTripDataset({
    domainSchemaVersion: 2,
    header: tripHeaderSchema.parse(rows.trip_headers[0]),
    heads: rows.content_heads.map((r) => contentHeadSchema.parse(r)),
    contents: rows.content_revisions.map((r) => contentRevisionSchema.parse(r)),
    records: rows.field_records.map((r) => fieldRecordSchema.parse(r)),
    proposals: rows.proposal_revisions.map((r) => proposalSchema.parse(r)),
    plans: parents.map((p) => ({
      ...p,
      days: days.filter((d) => d.planVersionId === p.planVersionId),
      items: items.filter((d) => d.planVersionId === p.planVersionId),
      legs: legs.filter((d) => d.planVersionId === p.planVersionId),
      stays: stays.filter((d) => d.planVersionId === p.planVersionId),
    })),
  });
}
export async function buildPackage(
  raw: unknown,
  assets: Map<string, Uint8Array>,
  source: {
    sourceRepository: string;
    sourceCommit: string;
    lineageId: string;
    adapterVersion: string;
    normalizationVersion: string;
  },
  report: unknown = {},
  mappings?: ImportMapping[],
) {
  const dataset = validateTripDataset(raw),
    rows = datasetRows(dataset),
    files = new Map<string, Uint8Array>();
  for (const collection of exchangeCollections) {
    files.set(`records/${collection}.ndjson`, encode(rows[collection].map((r) => canonicalJson(r) + '\n').join('')));
  }
  for (const c of dataset.contents) {
    if (c.kind === 'asset') {
      const bytes = assets.get(c.payload.hash);
      if (!bytes || bytes.length !== c.payload.byteLength || (await digestBytes(bytes)) !== c.payload.hash) {
        throw new Error('첨부 바이트/해시 불일치.');
      }
      files.set(`assets/sha256/${c.payload.hash}`, bytes);
    }
  }
  files.set(
    'reports/import-report.json',
    encode(
      canonicalJson(
        reportSchema.parse({
          report,
          mappings: mappings ?? currentMappings(dataset),
          blocking: typeof report === 'object' && report !== null && 'blocking' in report ? report.blocking : [],
        }),
      ),
    ),
  );
  const entries = await Promise.all(
    [...files].map(async ([path, bytes]) => ({
      path,
      role: path.startsWith('records/') ? 'records' : path.startsWith('assets/') ? 'asset' : 'report',
      byteLength: bytes.length,
      sha256: await digestBytes(bytes),
      ...(path.startsWith('records/')
        ? { collection: path.slice(8, -7), recordCount: rows[path.slice(8, -7) as Collection].length }
        : {}),
    })),
  );
  const manifest = manifestSchema.parse({
    format: 'travel-app-package',
    version: 2,
    domainSchemaVersion: 2,
    createdAt: new Date().toISOString(),
    packageId: crypto.randomUUID(),
    purpose: 'migration',
    source,
    tripIds: [dataset.header.tripId],
    files: entries,
  });
  const manifestBytes = encode(canonicalJson(manifest));
  const writer = new ZipWriter(new BlobWriter('application/zip'), { useWebWorkers: false });
  await writer.add('manifest.json', new Uint8ArrayReader(manifestBytes));
  for (const [path, bytes] of files) {
    await writer.add(path, new Uint8ArrayReader(bytes));
  }
  const blob = await writer.close();
  if (blob.size > LIMITS.zipBytes) {
    throw new Error('ZIP 크기 한도 초과.');
  }
  return { blob, manifest, packageDigest: await digestBytes(manifestBytes) };
}
export async function readArchive(blob: Blob, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (blob.size > LIMITS.zipBytes) {
    throw new Error('ZIP 크기 한도 초과.');
  }
  const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false });
  let total = 0;
  try {
    const entries = await reader.getEntries();
    if (entries.length > LIMITS.files + 1) {
      throw new Error('ZIP 파일 수 한도 초과.');
    }
    const names = new Set<string>();
    for (const e of entries) {
      if (
        names.has(e.filename.toLowerCase()) ||
        e.directory ||
        e.encrypted ||
        ((e.externalFileAttributes >>> 16) & 0o170000) === 0o120000 ||
        /^(?:[A-Za-z]:|\/)|\\|(?:^|\/)\.\.(?:\/|$)/.test(e.filename)
      ) {
        throw new Error('중복/위험 ZIP entry.');
      }
      names.add(e.filename.toLowerCase());
    }
    const read = async (path: string, limit: number) => {
      const entry = entries.find((e) => e.filename === path);
      if (!entry || entry.directory) {
        throw new Error(`파일 누락: ${path}`);
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      await entry.getData(
        new WritableStream<Uint8Array>({
          write(chunk) {
            if (signal?.aborted) {
              throw new Error('읽기를 취소했습니다.');
            }
            size += chunk.length;
            total += chunk.length;
            if (size > limit || total > LIMITS.uncompressedBytes) {
              throw new Error('압축 해제 한도 초과.');
            }
            chunks.push(chunk.slice());
          },
        }),
        { checkSignature: true, signal },
      );
      const bytes = new Uint8Array(size);
      let n = 0;
      for (const c of chunks) {
        bytes.set(c, n);
        n += c.length;
      }
      return bytes;
    };
    const manifestBytes = await read('manifest.json', LIMITS.manifestBytes),
      manifest = parseManifestJson(decode(manifestBytes));
    validateManifestPaths(
      entries.map((e) => e.filename),
      manifest,
    );
    const rows = blankRows(),
      assets = new Map<string, Uint8Array>();
    let report: unknown;
    for (const f of manifest.files) {
      const bytes = await read(f.path, f.role === 'asset' ? LIMITS.assetBytes : LIMITS.commandBytes);
      if (bytes.length !== f.byteLength || (await digestBytes(bytes)) !== f.sha256) {
        throw new Error(`파일 해시/크기 불일치: ${f.path}`);
      }
      if (f.role === 'records') {
        const value = decode(bytes);
        if (value.startsWith('\ufeff') || value.includes('\r') || (value.length && !value.endsWith('\n'))) {
          throw new Error('NDJSON은 BOM 없이 LF로 끝나야 합니다.');
        }
        const lines = value ? value.slice(0, -1).split('\n') : [];
        if (lines.length !== f.recordCount) {
          throw new Error('레코드 수 불일치.');
        }
        rows[f.collection!] = lines.map((line) => parseStrictJson(line, LIMITS.recordBytes));
      } else if (f.role === 'asset') {
        assets.set(f.sha256, bytes);
      } else {
        report = parseStrictJson(decode(bytes), LIMITS.commandBytes);
      }
    }
    for (const n of exchangeCollections) {
      if (!manifest.files.some((f) => f.collection === n)) {
        throw new Error(`필수 collection 누락: ${n}`);
      }
    }
    signal?.throwIfAborted();
    return { rows, assets, manifest, report, packageDigest: await digestBytes(manifestBytes) };
  } finally {
    await reader.close();
  }
}
export async function readPackage(blob: Blob, signal?: AbortSignal) {
  const archive = await readArchive(blob, signal),
    { rows, assets, manifest, packageDigest } = archive;
  if (manifest.format !== 'travel-app-package' || manifest.purpose !== 'migration') {
    throw new Error('현재 입력은 이행 패키지 v2입니다. 백업/복사형 가져오기는 별도 경로입니다.');
  }
  const report = reportSchema.parse(archive.report);
  if (report.blocking.length) {
    throw new Error('미해결 차단 항목이 있습니다.');
  }
  // Migration files cannot smuggle preserved command receipts or unknown operational rows.
  for (const n of [
    'import_packages',
    'import_heads',
    'import_mappings',
    'proposal_heads',
    'command_receipts',
  ] as Collection[]) {
    if (rows[n].length) {
      throw new Error(`이행 패키지의 ${n}은 비어 있어야 합니다.`);
    }
  }
  const dataset = rowsDataset(rows);
  if (dataset.header.tripId !== manifest.tripIds[0]) {
    throw new Error('manifest 여행 불일치.');
  }
  for (const c of dataset.contents) {
    if (c.kind === 'asset') {
      const b = assets.get(c.payload.hash);
      if (!b || b.length !== c.payload.byteLength) {
        throw new Error('첨부 메타데이터 불일치.');
      }
    }
  }
  const provenance: Provenance = {
    packageId: manifest.packageId,
    packageDigest,
    lineageId: manifest.source.lineageId,
    adapterVersion: manifest.source.adapterVersion,
    manifest,
    report: report.report,
    mappings: report.mappings,
  };
  return { dataset, assets, manifest, provenance };
}
