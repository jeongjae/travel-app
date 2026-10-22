import { BlobWriter, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js';
import { z } from 'zod';
import {
  canonicalJson,
  contentKind,
  contentRevisionSchema,
  digestBytes,
  exchangeCollections,
  id,
  LIMITS,
  manifestSchema,
  planDaySchema,
  planItemSchema,
  planLegSchema,
  planStaySchema,
  positive,
  receiptSchema,
  sourceRef,
  tripHeaderSchema,
  uint,
} from '../contracts/v2/index.ts';
import { storesV2 } from '../storage/schema.ts';
import { blankRows, readArchive, rowsDataset, type Collection } from './package.ts';

export type BackupRows = Record<Collection, unknown[]>;
export async function backupRowsFingerprint(rows: BackupRows) {
  const ordered = Object.fromEntries(exchangeCollections.map((n) => [n, rows[n].map((r) => canonicalJson(r)).sort()]));
  return digestBytes(new TextEncoder().encode(canonicalJson(ordered)));
}
type Row = Record<string, unknown> & { tripId: string; commitSeq?: number };
const mapping = z.strictObject({
  tripId: id,
  mappingRevisionId: id,
  lineageId: id,
  packageId: id,
  adapterVersion: z.string().min(1),
  commitSeq: positive,
  sourceKind: z.string().min(1),
  sourceKey: z.string().min(1),
  targetKind: z.enum([...contentKind.options, 'plan', 'trip']),
  entityId: id,
  baselineValue: z.json(),
  sourceRefs: z.array(sourceRef),
});
const importHead = z.strictObject({
  tripId: id,
  lineageId: id,
  sourceKind: z.string().min(1),
  sourceKey: z.string().min(1),
  mappingRevisionId: id,
});
const proposalHead = z.strictObject({
  tripId: id,
  proposalId: id,
  proposalRevisionId: id,
  proposalRevision: positive,
  status: z.enum(['pending', 'applied', 'rejected']),
});
const legacyReceipt = z.strictObject({
  tripId: id,
  requestId: id,
  fingerprintVersion: z.literal('prototype-v1'),
  fingerprint: z.string(),
  kind: z.literal('legacy'),
  commitSeq: positive,
});
const packageBase = {
  tripId: id,
  packageId: id,
  packageDigest: z.string().regex(/^[a-f0-9]{64}$/),
  lineageId: id,
  commitSeq: uint,
  report: z.json(),
};
const importPackage = z.union([
  z.strictObject({
    ...packageBase,
    adapterVersion: z.string().min(1),
    manifest: z.json(),
    mappings: z.array(
      mapping.omit({
        tripId: true,
        mappingRevisionId: true,
        lineageId: true,
        packageId: true,
        adapterVersion: true,
        commitSeq: true,
      }),
    ),
  }),
  z.strictObject({ ...packageBase, lineageId: z.literal('prototype-v1') }),
]);
const {
  tripId: _tripId,
  domainRevision: _domainRevision,
  currentPlanVersionId: _planId,
  ...metadataShape
} = tripHeaderSchema.shape;
const metadataSchema = z.strictObject(metadataShape);
const fail = (message: string): never => {
  throw new Error(`백업 검증: ${message}`);
};

// Only legacy originals need this codec: preserve explicit undefined without relaxing v2 JSON.
export function encodeLegacy(value: unknown): unknown {
  if (value === undefined) {
    return ['undefined'];
  }
  if (Array.isArray(value)) {
    return ['array', value.map(encodeLegacy)];
  }
  if (value !== null && typeof value === 'object') {
    return ['object', Object.entries(value).map(([k, v]) => [k, encodeLegacy(v)])];
  }
  return ['value', value];
}
export function decodeLegacy(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return fail('legacy 원문 인코딩');
  }
  if (value[0] === 'undefined' && value.length === 1) {
    return undefined;
  }
  if (
    value[0] === 'value' &&
    value.length === 2 &&
    (value[1] === null || ['string', 'number', 'boolean'].includes(typeof value[1]))
  ) {
    return value[1];
  }
  if (value.length !== 2 || !Array.isArray(value[1])) {
    return fail('legacy 원문 인코딩');
  }
  if (value[0] === 'array') {
    return value[1].map(decodeLegacy);
  }
  if (value[0] === 'object') {
    const result: Record<string, unknown> = {};
    for (const pair of value[1]) {
      if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || Object.hasOwn(result, pair[0])) {
        return fail('legacy 키');
      }
      Object.defineProperty(result, pair[0], {
        value: decodeLegacy(pair[1]),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return result;
  }
  return fail('legacy 원문 태그');
}
export function backupPackageRow(raw: unknown, decode = false): unknown {
  const row = raw as Row;
  if (row.lineageId !== 'prototype-v1') {
    return raw;
  }
  const report = row.report as Record<string, unknown>;
  if (!report || !Object.hasOwn(report, 'original')) {
    return fail('legacy 원문 누락');
  }
  return {
    ...row,
    report: { ...report, original: decode ? decodeLegacy(report.original) : encodeLegacy(report.original) },
  };
}

export function validateBackup(rows: BackupRows, tripIds: string[], cutSeq: number) {
  const known = new Set(tripIds);
  if (known.size !== tripIds.length || rows.trip_headers.length !== known.size) {
    fail('여행 목록/헤더 수');
  }
  for (const collection of exchangeCollections) {
    const keys = new Set<string>();
    const fields = storesV2[collection]
      .split(']')[0]
      .slice(1)
      .split('+')
      .filter((f) => f !== 'spaceId');
    for (const raw of rows[collection]) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        fail('객체 행 필요');
      }
      const r = raw as Row;
      if (!known.has(r.tripId) || 'spaceId' in r) {
        fail('알 수 없는 여행/물리 공간');
      }
      const key = canonicalJson(fields.map((f) => r[f]));
      if (keys.has(key)) {
        fail(`중복 ${collection}`);
      }
      keys.add(key);
      if (
        'commitSeq' in r &&
        (!Number.isSafeInteger(r.commitSeq) || (r.commitSeq as number) < 0 || (r.commitSeq as number) > cutSeq)
      ) {
        fail('cutSeq 이후/잘못된 순번');
      }
    }
  }
  rows.import_packages.forEach((r) => importPackage.parse(r));
  rows.import_mappings.forEach((r) => mapping.parse(r));
  rows.import_heads.forEach((r) => importHead.parse(r));
  rows.proposal_heads.forEach((r) => proposalHead.parse(r));
  rows.command_receipts.forEach((r) =>
    (r as Row).fingerprintVersion === 2 ? receiptSchema.parse(r) : legacyReceipt.parse(r),
  );
  for (const tripId of tripIds) {
    const group = blankRows();
    for (const n of exchangeCollections) {
      group[n] = rows[n].filter((r) => (r as Row).tripId === tripId);
    }
    const t = rowsDataset(group),
      packages = group.import_packages as Row[],
      mappings = group.import_mappings as Row[];
    for (const m of mappings) {
      if (!packages.some((p) => p.packageId === m.packageId && p.lineageId === m.lineageId)) {
        fail('B의 패키지 참조');
      }
      if (
        m.targetKind === 'trip'
          ? m.entityId !== tripId
          : m.targetKind === 'plan'
            ? m.entityId !== 'current-plan'
            : !t.contents.some((c) => c.kind === m.targetKind && c.entityId === m.entityId)
      ) {
        fail('B의 대상 참조');
      }
      if (m.targetKind === 'trip') {
        tripHeaderSchema.parse({ ...t.header, ...metadataSchema.parse(m.baselineValue) });
      } else if (m.targetKind === 'plan') {
        z.strictObject({
          days: z.array(planDaySchema.omit({ planVersionId: true })),
          items: z.array(planItemSchema.omit({ planVersionId: true })),
          legs: z.array(planLegSchema.omit({ planVersionId: true })),
          stays: z.array(planStaySchema.omit({ planVersionId: true })),
        }).parse(m.baselineValue);
      } else {
        const target = t.contents.find((c) => c.kind === m.targetKind && c.entityId === m.entityId)!;
        contentRevisionSchema.parse({ ...target, payload: m.baselineValue });
      }
    }
    const mappingGroups = new Set(mappings.map((m) => canonicalJson([m.lineageId, m.sourceKind, m.sourceKey])));
    if (group.import_heads.length !== mappingGroups.size) {
      fail('B head 수');
    }
    for (const h of group.import_heads as Row[]) {
      if (
        !mappings.some((m) => ['lineageId', 'sourceKind', 'sourceKey', 'mappingRevisionId'].every((k) => m[k] === h[k]))
      ) {
        fail('B head 참조');
      }
    }
    const latest = new Map<string, (typeof t.proposals)[number]>();
    for (const p of t.proposals) {
      if (!latest.has(p.proposalId) || latest.get(p.proposalId)!.proposalRevision < p.proposalRevision) {
        latest.set(p.proposalId, p);
      }
    }
    if (group.proposal_heads.length !== latest.size) {
      fail('초안 head 수');
    }
    for (const h of group.proposal_heads as Row[]) {
      const p = latest.get(h.proposalId as string);
      if (
        !p ||
        p.proposalRevisionId !== h.proposalRevisionId ||
        p.proposalRevision !== h.proposalRevision ||
        p.status !== h.status
      ) {
        fail('초안 head 참조');
      }
    }
    for (const raw of group.command_receipts) {
      const r = raw as z.infer<typeof receiptSchema>;
      if (r.fingerprintVersion !== 2) {
        continue;
      }
      if (r.domainRevision > t.header.domainRevision) {
        fail('영수증 revision');
      }
      for (const ref of r.result.resultRefs) {
        const found =
          ref.kind === 'trip'
            ? ref.id === tripId
            : ref.kind === 'plan'
              ? t.plans.some((p) => p.planVersionId === ref.id)
              : ref.kind === 'record'
                ? t.records.some((p) => p.recordId === ref.id)
                : ref.kind === 'proposal'
                  ? t.proposals.some(
                      (p) => p.proposalId === ref.id && (!ref.revisionId || p.proposalRevisionId === ref.revisionId),
                    )
                  : t.contents.some(
                      (c) =>
                        c.kind === ref.kind &&
                        c.entityId === ref.id &&
                        (!ref.revisionId || c.revisionId === ref.revisionId),
                    );
        if (!found) {
          fail('영수증 결과 참조');
        }
      }
    }
  }
}

export async function buildBackup(
  rows: BackupRows,
  assets: Map<string, Uint8Array>,
  snapshotId: string,
  cutSeq: number,
  signal?: AbortSignal,
) {
  const tripIds = (rows.trip_headers as Row[]).map((h) => h.tripId);
  validateBackup(rows, tripIds, cutSeq);
  const files = new Map<string, Uint8Array>(),
    encode = (s: string) => new TextEncoder().encode(s);
  for (const n of exchangeCollections) {
    signal?.throwIfAborted();
    const lines = rows[n].map((r) => canonicalJson(r));
    if (lines.some((l) => encode(l).length > LIMITS.recordBytes)) {
      fail('단일 행 한도');
    }
    files.set(`records/${n}.ndjson`, encode(lines.map((l) => l + '\n').join('')));
  }
  for (const [hash, bytes] of assets) {
    signal?.throwIfAborted();
    if (bytes.length > LIMITS.assetBytes || (await digestBytes(bytes)) !== hash) {
      fail('첨부 해시/한도');
    }
    files.set(`assets/sha256/${hash}`, bytes);
  }
  files.set(
    'reports/import-report.json',
    encode(canonicalJson({ backupContract: 'full-v2', legacyOriginalEncoding: 'tagged-v1' })),
  );
  const entries = [];
  for (const [path, bytes] of files) {
    const collection = path.slice(8, -7) as Collection;
    entries.push({
      path,
      role: path.startsWith('records/') ? 'records' : path.startsWith('assets/') ? 'asset' : 'report',
      byteLength: bytes.length,
      sha256: await digestBytes(bytes),
      ...(path.startsWith('records/') ? { collection, recordCount: rows[collection].length } : {}),
    });
  }
  const manifest = manifestSchema.parse({
    format: 'travel-app-backup',
    version: 2,
    domainSchemaVersion: 2,
    createdAt: new Date().toISOString(),
    snapshotId,
    cutSeq,
    tripIds,
    files: entries,
  });
  if (manifest.format !== 'travel-app-backup') {
    return fail('백업 manifest');
  }
  if ([...files.values()].some((b) => b.length > LIMITS.commandBytes && ![...assets.values()].includes(b))) {
    fail('레코드 파일 한도');
  }
  const writer = new ZipWriter(new BlobWriter('application/zip'), { useWebWorkers: false });
  try {
    await writer.add('manifest.json', new Uint8ArrayReader(encode(canonicalJson(manifest))), { signal });
    for (const [path, bytes] of files) {
      signal?.throwIfAborted();
      await writer.add(path, new Uint8ArrayReader(bytes), { signal });
    }
    const blob = await writer.close();
    if (blob.size > LIMITS.zipBytes) {
      fail('ZIP 한도');
    }
    return { blob, manifest };
  } catch (error) {
    await writer.close().catch(() => {});
    throw error;
  }
}
export async function readBackup(blob: Blob, signal?: AbortSignal) {
  const archive = await readArchive(blob, signal);
  if (archive.manifest.format !== 'travel-app-backup') {
    fail('전체 백업 v2 필요');
  }
  z.strictObject({ backupContract: z.literal('full-v2'), legacyOriginalEncoding: z.literal('tagged-v1') }).parse(
    archive.report,
  );
  const manifest = archive.manifest as Extract<typeof archive.manifest, { format: 'travel-app-backup' }>;
  validateBackup(archive.rows, manifest.tripIds, manifest.cutSeq);
  const required = new Map<string, number>();
  for (const raw of archive.rows.content_revisions) {
    const c = raw as { kind: string; payload: { hash: string; byteLength: number } };
    if (c.kind === 'asset') {
      if (required.has(c.payload.hash) && required.get(c.payload.hash) !== c.payload.byteLength) {
        fail('첨부 크기 충돌');
      }
      required.set(c.payload.hash, c.payload.byteLength);
    }
  }
  if (required.size !== archive.assets.size) {
    fail('불필요한/누락 첨부');
  }
  for (const [hash, size] of required) {
    if (archive.assets.get(hash)?.length !== size) {
      fail('첨부 크기');
    }
  }
  return { ...archive, manifest };
}
