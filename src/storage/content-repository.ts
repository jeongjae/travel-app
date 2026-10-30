import Dexie from 'dexie';
import {
  canonicalJson,
  commandFingerprint,
  contentRevisionSchema,
  digestBytes,
  receiptSchema,
  validateCommand,
  validateImmutableTransition,
  validateTripDataset,
  LIMITS,
  type Command,
  type ContentRevision,
  type FieldRecord,
  type PlanVersion,
  type Proposal,
  type RevisionRef,
  type TripDataset,
} from '../contracts/v2/index';
import { storesV2, type Stored, type Workspace } from './schema';
import { convertLegacy, legacyId, legacyCanonical } from './legacy';
import type { Trip } from '../domain';
import { canonicalPlanValue, comparablePlan, comparableTrip } from '../transfer/comparable';
import {
  compareReimport,
  localPayload,
  mappingKey,
  patchValue,
  retarget,
  type Choice,
  type Review,
} from '../transfer/reimport';
import * as recovery from './recovery';
import { applyContentBatch } from './content-batch';
import { guardContentUpdate } from './content-update';
import { dayRegionsFromStays, isProblem, stayRange, type StayRange } from '../plan/manual-stays';
import { prepareAssetRecord, readAssetRecord, discardPreparedFiles, type AssetRecord } from './asset-files.ts';

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const clean = <T>(row: Stored<T>): T => {
  const { spaceId: _, ...rest } = row;
  return rest as T;
};
export class RepositoryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}
function must(ok: unknown, code: string, message: string): asserts ok {
  if (!ok) {
    throw new RepositoryError(code, message);
  }
}
export type Result = {
  status: 'applied' | 'replayed';
  requestId: string;
  domainRevision: number;
  commitSeq: number;
  resultRefs: { kind: string; id: string; revisionId?: string }[];
};
type Receipt = {
  tripId: string;
  requestId: string;
  fingerprintVersion: 2 | 'prototype-v1';
  fingerprint: string;
  kind: string;
  result: Result;
  commitSeq: number;
  domainRevision: number;
  completedAt: string;
};
export type ImportMapping = {
  sourceKind: string;
  sourceKey: string;
  targetKind: ContentRevision['kind'] | 'plan' | 'trip';
  entityId: string;
  baselineValue: unknown;
  sourceRefs: ContentRevision['sourceRefs'];
};
export type Provenance = {
  packageId: string;
  packageDigest: string;
  lineageId: string;
  adapterVersion: string;
  manifest: unknown;
  report: unknown;
  mappings: ImportMapping[];
};
type Prepared = {
  jobId: string;
  spaceId: string;
  tripId: string;
  status: 'ready';
  dataset: TripDataset;
  provenance: Provenance;
};
type Reviewed = Prepared & { review?: Review; choices?: Record<string, Choice>; reviewDigest?: string };

export class ContentRepository {
  constructor(readonly db: Dexie) {}
  createBackup(signal?: AbortSignal, onProgress?: (text: string) => void | Promise<void>) {
    return recovery.createBackup(this.db, signal, onProgress);
  }
  prepareRestore(blob: Blob, signal?: AbortSignal, onProgress?: (text: string) => void | Promise<void>) {
    return recovery.prepareRestore(this.db, blob, signal, onProgress);
  }
  activateRestore(jobId: string, signal?: AbortSignal) {
    return recovery.activateRestore(this.db, jobId, signal);
  }
  assetStatus(tripId: string) {
    return recovery.assetStatus(this.db, tripId);
  }
  repairAssets(tripId: string, assets: Map<string, Uint8Array>, signal?: AbortSignal) {
    return recovery.repairAssets(this.db, tripId, assets, signal);
  }
  discardTransfer(jobId: string) {
    return recovery.discardTransfer(this.db, jobId);
  }
  collectOrphanAssets() {
    return recovery.collectOrphanAssets(this.db);
  }
  async pendingSnapshots() {
    return this.db.table<{ snapshotId: string; cutSeq: number }>('snapshot_jobs').toArray();
  }
  async discardSnapshot(snapshotId: string) {
    await this.db.table('snapshot_jobs').delete(snapshotId);
  }
  async pendingTransfers() {
    return (await this.db.table('transfer_jobs').toArray())
      .filter((j) => j.status !== 'succeeded')
      .map((j) => ({ jobId: j.jobId as string, status: j.status as string, mode: (j.mode ?? 'import') as string }));
  }
  private tables() {
    return Object.keys(storesV2).map((name) => this.db.table(name));
  }
  async init() {
    return this.db.transaction('rw', [this.db.table('workspace_meta'), this.db.table('trips')], async () => {
      const table = this.db.table<Workspace>('workspace_meta');
      let meta = await table.get('workspace');
      if (!meta) {
        meta = {
          id: 'workspace',
          activeSpaceId: uid(),
          writeSeq: 0,
          dbContractVersion: 2,
          mode: (await this.db.table('trips').count()) ? 'legacy' : 'v2',
        };
        await table.add(meta);
      }
      return meta;
    });
  }
  async meta() {
    const meta = await this.db.table<Workspace>('workspace_meta').get('workspace');
    must(meta, 'NOT_INITIALIZED', '저장소를 초기화하세요.');
    return meta;
  }
  async prepareLegacy() {
    const originals = await this.db.table<Trip>('trips').toArray();
    return {
      fingerprint: await digestBytes(new TextEncoder().encode(legacyCanonical(originals))),
      originals,
      converted: originals.map(convertLegacy),
    };
  }
  async activateLegacy(prepared: Awaited<ReturnType<ContentRepository['prepareLegacy']>>) {
    // Hash outside the transaction, then compare the complete canonical input inside it.
    const expected = legacyCanonical(prepared.originals),
      converted = prepared.originals.map(convertLegacy),
      space = uid();
    must(
      (await digestBytes(new TextEncoder().encode(expected))) === prepared.fingerprint,
      'CONFLICT',
      '전환 입력 fingerprint가 다릅니다.',
    );
    return this.db.transaction('rw', [...this.tables(), this.db.table('trips')], async () => {
      const m = await this.meta();
      must(m.mode === 'legacy', 'CONFLICT', '이미 전환되었습니다.');
      must(
        legacyCanonical(await this.db.table('trips').toArray()) === expected,
        'CONFLICT',
        '기존 데이터가 변경되어 전환을 취소했습니다.',
      );
      let cut = m.writeSeq;
      for (let n = 0; n < converted.length; n++) {
        const t = structuredClone(converted[n].dataset),
          offset = cut;
        const rows = [...t.contents, ...t.plans, ...t.records, ...t.proposals];
        rows.forEach((r) => {
          r.commitSeq += offset;
        });
        cut = Math.max(cut, ...rows.map((r) => r.commitSeq));
        await this.putDataset(t, space);
        await this.db.table('import_packages').add({
          spaceId: space,
          tripId: t.header.tripId,
          packageId: `legacy-${t.header.tripId}`,
          packageDigest: prepared.fingerprint,
          lineageId: 'prototype-v1',
          commitSeq: cut,
          report: { warnings: converted[n].warnings, original: prepared.originals[n] },
        });
        for (const receipt of prepared.originals[n].receipts) {
          await this.db.table('command_receipts').add({
            spaceId: space,
            tripId: t.header.tripId,
            requestId: legacyId(receipt.id),
            fingerprintVersion: 'prototype-v1',
            fingerprint: receipt.fingerprint,
            kind: 'legacy',
            commitSeq: cut,
          });
        }
      }
      await this.db
        .table<Workspace>('workspace_meta')
        .put({ ...m, activeSpaceId: space, writeSeq: cut + 1, mode: 'v2' });
    });
  }
  private async rows<T>(name: string, spaceId: string, tripId: string): Promise<T[]> {
    return (
      await this.db
        .table<Stored<T>>(name)
        .where(':id')
        .between([spaceId, tripId], [spaceId, tripId, Dexie.maxKey], true, true)
        .toArray()
    ).map(clean);
  }
  async list() {
    const m = await this.meta();
    return this.db
      .table<Stored<TripDataset['header']>>('trip_headers')
      .where(':id')
      .between([m.activeSpaceId], [m.activeSpaceId, Dexie.maxKey])
      .toArray()
      .then((rows) => rows.map(clean));
  }
  async get(tripId: string, spaceId?: string): Promise<TripDataset> {
    const space = spaceId ?? (await this.meta()).activeSpaceId;
    return this.db.transaction('r', this.tables(), async () => {
      const header = await this.db.table<Stored<TripDataset['header']>>('trip_headers').get([space, tripId]);
      must(header, 'NOT_FOUND', '여행을 찾을 수 없습니다.');
      const [heads, contents, parents, days, items, legs, stays, records, proposals] = await Promise.all([
        this.rows<TripDataset['heads'][number]>('content_heads', space, tripId),
        this.rows<ContentRevision>('content_revisions', space, tripId),
        this.rows<Omit<PlanVersion, 'days' | 'items' | 'legs' | 'stays'>>('plan_versions', space, tripId),
        this.rows<PlanVersion['days'][number]>('plan_days', space, tripId),
        this.rows<PlanVersion['items'][number]>('plan_items', space, tripId),
        this.rows<PlanVersion['legs'][number]>('plan_legs', space, tripId),
        this.rows<PlanVersion['stays'][number]>('plan_stays', space, tripId),
        this.rows<FieldRecord>('field_records', space, tripId),
        this.rows<Proposal>('proposal_revisions', space, tripId),
      ]);
      return validateTripDataset({
        domainSchemaVersion: 2,
        header: clean(header),
        heads,
        contents,
        plans: parents
          .sort((a, b) => a.number - b.number)
          .map((p) => ({
            ...p,
            days: days.filter((d) => d.planVersionId === p.planVersionId).sort((a, b) => a.ordinal - b.ordinal),
            items: items.filter((i) => i.planVersionId === p.planVersionId).sort((a, b) => a.order - b.order),
            legs: legs.filter((l) => l.planVersionId === p.planVersionId),
            stays: stays.filter((s) => s.planVersionId === p.planVersionId),
          })),
        records: records.sort((a, b) => a.commitSeq - b.commitSeq),
        proposals: proposals.sort((a, b) => a.commitSeq - b.commitSeq),
      });
    });
  }
  async content(tripId: string, kind: ContentRevision['kind'], entityId: string, revisionId?: string) {
    const { activeSpaceId: space } = await this.meta();
    return this.db.transaction('r', [this.db.table('content_heads'), this.db.table('content_revisions')], async () => {
      const head = await this.db
        .table<Stored<TripDataset['heads'][number]>>('content_heads')
        .get([space, tripId, kind, entityId]);
      const revision = revisionId ?? head?.revisionId;
      if (!revision) {
        return undefined;
      }
      const c = await this.db
        .table<Stored<ContentRevision>>('content_revisions')
        .get([space, tripId, kind, entityId, revision]);
      return c ? contentRevisionSchema.parse(clean(c)) : undefined;
    });
  }
  async catalog(tripId: string, kind: ContentRevision['kind']) {
    const m = await this.meta();
    return this.db.transaction('r', [this.db.table('content_heads'), this.db.table('content_revisions')], async () => {
      const heads = await this.db
        .table<Stored<TripDataset['heads'][number]>>('content_heads')
        .where('[spaceId+tripId+targetKind+status]')
        .equals([m.activeSpaceId, tripId, kind, 'active'])
        .toArray();
      const rows = await this.db
        .table<Stored<ContentRevision>>('content_revisions')
        .bulkGet(heads.map((h) => [m.activeSpaceId, tripId, kind, h.entityId, h.revisionId]));
      return rows.filter((r): r is Stored<ContentRevision> => Boolean(r)).map(clean);
    });
  }
  async plan(tripId: string, planVersionId: string) {
    const { activeSpaceId: space } = await this.meta();
    return this.db.transaction(
      'r',
      ['plan_versions', 'plan_days', 'plan_items', 'plan_legs', 'plan_stays'].map((n) => this.db.table(n)),
      async () => {
        const p = await this.db
          .table<Stored<Omit<PlanVersion, 'days' | 'items' | 'legs' | 'stays'>>>('plan_versions')
          .get([space, tripId, planVersionId]);
        must(p, 'NOT_FOUND', '계획이 없습니다.');
        const children = async <T>(name: string) =>
          (
            await this.db
              .table<Stored<T>>(name)
              .where(':id')
              .between([space, tripId, planVersionId], [space, tripId, planVersionId, Dexie.maxKey])
              .toArray()
          ).map(clean);
        return {
          ...clean(p),
          days: (await children<PlanVersion['days'][number]>('plan_days')).sort((a, b) => a.ordinal - b.ordinal),
          items: await children<PlanVersion['items'][number]>('plan_items'),
          legs: await children<PlanVersion['legs'][number]>('plan_legs'),
          stays: await children<PlanVersion['stays'][number]>('plan_stays'),
        };
      },
    );
  }
  async timeline(tripId: string) {
    const m = await this.meta();
    return this.rows<FieldRecord>('field_records', m.activeSpaceId, tripId);
  }
  async proposals(tripId: string) {
    const m = await this.meta();
    return this.rows<Proposal>('proposal_revisions', m.activeSpaceId, tripId);
  }
  async importHistory(tripId: string) {
    const m = await this.meta();
    return this.rows<{
      packageId: string;
      packageDigest: string;
      lineageId: string;
      commitSeq: number;
      report: unknown;
    }>('import_packages', m.activeSpaceId, tripId);
  }
  private async baselines(space: string, tripId: string, lineageId: string) {
    const heads = await this.rows<{ lineageId: string; mappingRevisionId: string }>('import_heads', space, tripId);
    const rows = await this.rows<ImportMapping & { mappingRevisionId: string }>('import_mappings', space, tripId);
    return heads
      .filter((h) => h.lineageId === lineageId)
      .map((h) => rows.find((r) => r.mappingRevisionId === h.mappingRevisionId)!);
  }
  async reviewReimport(jobId: string): Promise<Review> {
    return this.db.transaction('r', this.tables(), async () => {
      const m = await this.meta(),
        job = await this.db.table<Prepared>('transfer_jobs').get(jobId);
      must(job && job.spaceId === m.activeSpaceId, 'CONFLICT', '준비 영역이 변경되었습니다.');
      const before = await this.get(job.tripId);
      const baseline = await this.baselines(m.activeSpaceId, job.tripId, job.provenance.lineageId);
      must(baseline.length, 'INVALID_INPUT', '같은 원본 계보의 적용 기준 B가 없습니다.');
      return compareReimport(before, job.provenance.mappings, baseline, {
        jobId,
        lineageId: job.provenance.lineageId,
        packageId: job.provenance.packageId,
        packageDigest: job.provenance.packageDigest,
      });
    });
  }
  async prepareReimportDecision(review: Review, choices: Record<string, Choice>) {
    const current = await this.reviewReimport(review.jobId);
    must(canonicalJson(current) === canonicalJson(review), 'CONFLICT', '검토 중 내용이 변경되었습니다.');
    must(
      Object.keys(choices).length === review.units.length &&
        review.units.every((u) => ['remote', 'local', 'defer'].includes(choices[u.key])),
      'INVALID_INPUT',
      '모든 차이의 선택을 확인하세요.',
    );
    const reviewDigest = await digestBytes(new TextEncoder().encode(canonicalJson({ review, choices })));
    await this.db.transaction('rw', this.db.table('transfer_jobs'), async () => {
      const job = await this.db.table<Reviewed>('transfer_jobs').get(review.jobId);
      must(job, 'NOT_FOUND', '준비 자료가 없습니다.');
      await this.db.table('transfer_jobs').put({ ...job, review, choices, reviewDigest });
    });
    return reviewDigest;
  }
  async history(tripId: string) {
    const m = await this.meta();
    return this.rows<Omit<PlanVersion, 'days' | 'items' | 'legs' | 'stays'>>('plan_versions', m.activeSpaceId, tripId);
  }
  async currentContext(tripId: string): Promise<RevisionRef[]> {
    const m = await this.meta();
    return this.db.transaction('r', [this.db.table('content_heads'), this.db.table('content_revisions')], async () => {
      const heads = await this.rows<TripDataset['heads'][number]>('content_heads', m.activeSpaceId, tripId);
      return Promise.all(
        heads.map(async (h) => {
          const asset =
            h.targetKind === 'asset'
              ? await this.db
                  .table<Stored<Extract<ContentRevision, { kind: 'asset' }>>>('content_revisions')
                  .get([m.activeSpaceId, tripId, 'asset', h.entityId, h.revisionId])
              : undefined;
          return {
            tripId,
            targetKind: h.targetKind,
            entityId: h.entityId,
            revisionId: h.revisionId,
            ...(asset ? { hash: asset.payload.hash } : {}),
          };
        }),
      );
    });
  }
  async asset(tripId: string, assetId: string, context?: RevisionRef[]) {
    const c = await this.content(
      tripId,
      'asset',
      assetId,
      context?.find((r) => r.targetKind === 'asset' && r.entityId === assetId)?.revisionId,
    );
    if (c?.kind !== 'asset') {
      return undefined;
    }
    const m = await this.meta();
    const row = await this.db.table<AssetRecord>('asset_blobs').get([m.activeSpaceId, tripId, c.payload.hash]);
    const blob = await readAssetRecord(this.db, row, c.payload.hash, c.payload.byteLength);
    return blob ? { blob: new Blob([blob], { type: c.payload.mimeType }), content: c } : undefined;
  }
  private async putDataset(t: TripDataset, spaceId: string, before?: TripDataset) {
    const store = async <T>(name: string, rows: T[], mutable = false) => {
      const table = this.db.table<Stored<T>>(name);
      if (rows.length) {
        await (mutable
          ? table.bulkPut(rows.map((r) => ({ ...r, spaceId })))
          : table.bulkAdd(rows.map((r) => ({ ...r, spaceId }))));
      }
    };
    await store('trip_headers', [t.header], true);
    await store('content_heads', t.heads, true);
    await store(
      'content_revisions',
      t.contents.filter(
        (c) =>
          !before?.contents.some(
            (b) => b.kind === c.kind && b.entityId === c.entityId && b.revisionId === c.revisionId,
          ),
      ),
    );
    for (const p of t.plans.filter((p) => !before?.plans.some((b) => b.planVersionId === p.planVersionId))) {
      const { days, items, legs, stays, ...parent } = p;
      await store('plan_versions', [parent]);
      await store('plan_days', days);
      await store('plan_items', items);
      await store('plan_legs', legs);
      await store('plan_stays', stays);
    }
    await store(
      'field_records',
      t.records.filter((r) => !before?.records.some((b) => b.recordId === r.recordId)),
    );
    await store(
      'proposal_revisions',
      t.proposals.filter(
        (r) =>
          !before?.proposals.some(
            (b) => b.proposalId === r.proposalId && b.proposalRevisionId === r.proposalRevisionId,
          ),
      ),
    );
    const latest = new Map<string, Proposal>();
    t.proposals.forEach((p) => {
      if ((latest.get(p.proposalId)?.proposalRevision ?? 0) < p.proposalRevision) {
        latest.set(p.proposalId, p);
      }
    });
    await store(
      'proposal_heads',
      [...latest.values()].map((p) => ({
        tripId: t.header.tripId,
        proposalId: p.proposalId,
        proposalRevisionId: p.proposalRevisionId,
        proposalRevision: p.proposalRevision,
        status: p.status,
      })),
      true,
    );
  }
  async prepareImport(raw: unknown, assets: Map<string, Uint8Array>, provenance: Provenance) {
    const dataset = validateTripDataset(raw),
      meta = await this.meta();
    must(
      new TextEncoder().encode(canonicalJson(provenance)).length + 1024 <= LIMITS.provenanceBytes,
      'LIMIT_EXCEEDED',
      '패키지 출처·대응 기준의 보관 한도를 초과했습니다.',
    );
    const mappingKeys = new Set<string>();
    for (const mapping of provenance.mappings) {
      const key = canonicalJson([mapping.sourceKind, mapping.sourceKey]);
      must(!mappingKeys.has(key), 'INVALID_INPUT', '중복 원천 대응입니다.');
      mappingKeys.add(key);
      const head = dataset.heads.find((h) => h.targetKind === mapping.targetKind && h.entityId === mapping.entityId);
      const row = dataset.contents.find(
        (c) => c.kind === head?.targetKind && c.entityId === head.entityId && c.revisionId === head.revisionId,
      );
      const value =
        mapping.targetKind === 'plan'
          ? comparablePlan(dataset.plans.find((p) => p.planVersionId === dataset.header.currentPlanVersionId)!)
          : mapping.targetKind === 'trip'
            ? comparableTrip(dataset.header)
            : row?.payload;
      must(
        value &&
          canonicalJson(value) ===
            canonicalJson(
              mapping.targetKind === 'plan' ? canonicalPlanValue(mapping.baselineValue) : mapping.baselineValue,
            ),
        'INVALID_INPUT',
        '기준 B가 대상 콘텐츠와 다릅니다.',
      );
    }
    for (const head of dataset.heads.filter((h) => h.status === 'active')) {
      must(
        provenance.mappings.some((m) => m.targetKind === head.targetKind && m.entityId === head.entityId),
        'INVALID_INPUT',
        '활성 콘텐츠의 완전한 원천 대응이 필요합니다.',
      );
    }
    must(
      provenance.mappings.some((m) => m.targetKind === 'plan') &&
        provenance.mappings.some((m) => m.targetKind === 'trip'),
      'INVALID_INPUT',
      '계획·여행 메타데이터 대응이 필요합니다.',
    );
    for (const c of dataset.contents) {
      if (c.kind === 'asset') {
        const bytes = assets.get(c.payload.hash);
        must(
          bytes && bytes.byteLength === c.payload.byteLength && (await digestBytes(bytes)) === c.payload.hash,
          'MISSING_ASSET',
          '첨부 바이트/해시 불일치.',
        );
      }
    }
    const rowCount =
      dataset.contents.length +
      dataset.heads.length +
      dataset.records.length +
      dataset.proposals.length +
      dataset.plans.reduce((n, p) => n + 1 + p.days.length + p.items.length + p.legs.length + p.stays.length, 1);
    must(
      rowCount <= LIMITS.commandRows && new TextEncoder().encode(canonicalJson(dataset)).length <= LIMITS.commandBytes,
      'LIMIT_EXCEEDED',
      '구조 변경 한도 초과.',
    );
    const jobId = uid();
    const preparedAssets: AssetRecord[] = [];
    try {
      for (const [hash, bytes] of assets) {
        if (dataset.contents.some((content) => content.kind === 'asset' && content.payload.hash === hash)) {
          preparedAssets.push(
            await prepareAssetRecord(this.db, meta.activeSpaceId, dataset.header.tripId, hash, bytes),
          );
        }
      }
      await this.db.transaction(
        'rw',
        ['workspace_meta', 'transfer_jobs', 'asset_blobs'].map((name) => this.db.table(name)),
        async () => {
          must((await this.meta()).activeSpaceId === meta.activeSpaceId, 'CONFLICT', '저장 영역이 변경되었습니다.');
          for (const record of preparedAssets) {
            const table = this.db.table('asset_blobs');
            if (!(await table.get([record.spaceId, record.tripId, record.sha256]))) {
              await table.add(record);
            }
          }
          await this.db.table<Prepared>('transfer_jobs').add({
            jobId,
            spaceId: meta.activeSpaceId,
            tripId: dataset.header.tripId,
            status: 'ready',
            dataset,
            provenance,
          });
        },
      );
    } finally {
      await discardPreparedFiles(this.db, preparedAssets);
    }
    return jobId;
  }
  private async importRows(spaceId: string, t: TripDataset, prov: Provenance, seq: number, selected?: ImportMapping[]) {
    const table = this.db.table('import_packages');
    if (!(await table.get([spaceId, t.header.tripId, prov.packageId]))) {
      await table.add({ ...prov, tripId: t.header.tripId, spaceId, commitSeq: seq });
    }
    for (const mapping of selected ?? prov.mappings) {
      const mappingRevisionId = uid();
      await this.db.table('import_mappings').add({
        ...mapping,
        spaceId,
        tripId: t.header.tripId,
        mappingRevisionId,
        lineageId: prov.lineageId,
        packageId: prov.packageId,
        adapterVersion: prov.adapterVersion,
        commitSeq: seq,
      });
      await this.db.table('import_heads').put({
        spaceId,
        tripId: t.header.tripId,
        lineageId: prov.lineageId,
        sourceKind: mapping.sourceKind,
        sourceKey: mapping.sourceKey,
        mappingRevisionId,
      });
    }
  }
  async execute(raw: unknown): Promise<Result> {
    const c = validateCommand(raw),
      fingerprint = await commandFingerprint(c);
    return this.db.transaction('rw', this.tables(), async () => {
      const m = await this.meta();
      must(m.mode === 'v2', 'LEGACY_MODE', '기존 데이터의 검토·전환이 필요합니다.');
      const space = m.activeSpaceId;
      const receipts = this.db.table<Stored<Receipt>>('command_receipts');
      const old = await receipts.get([space, c.tripId, c.requestId]);
      if (old) {
        must(old.fingerprintVersion === 2, 'LEGACY_RECEIPT_UNSUPPORTED', '기존 v1 요청은 새 요청 ID로 처리하세요.');
        must(old.fingerprint === fingerprint, 'REQUEST_ID_REUSED', '같은 요청 ID의 입력이 다릅니다.');
        return { ...old.result, status: 'replayed' };
      }
      must(Number.isSafeInteger(m.writeSeq + 1), 'LIMIT_EXCEEDED', '저장 순번 한도.');
      const seq = m.writeSeq + 1;
      let before: TripDataset | undefined, t: TripDataset;
      const refs: Result['resultRefs'] = [];
      if (c.kind === 'ImportNewTrip') {
        must(!(await this.db.table('trip_headers').get([space, c.tripId])), 'CONFLICT', '같은 여행이 있습니다.');
        const job = (await this.db.table<Prepared>('transfer_jobs').where('spaceId').equals(space).toArray()).find(
          (j) =>
            j.tripId === c.tripId &&
            j.provenance.packageId === c.payload.packageId &&
            j.provenance.packageDigest === c.payload.packageDigest,
        );
        must(job, 'INVALID_INPUT', '검증된 패키지를 먼저 준비하세요.');
        t = structuredClone(job.dataset);
        // Imported histories share this activation boundary; ordering within each immutable chain is retained.
        const max = Math.max(
          0,
          ...t.contents.map((r) => r.commitSeq),
          ...t.plans.map((r) => r.commitSeq),
          ...t.records.map((r) => r.commitSeq),
          ...t.proposals.map((r) => r.commitSeq),
        );
        const offset = m.writeSeq;
        for (const r of [...t.contents, ...t.plans, ...t.records, ...t.proposals]) {
          r.commitSeq += offset;
        }
        m.writeSeq = offset + Math.max(1, max);
        await this.checkAssets(t, space);
        await this.importRows(space, t, job.provenance, m.writeSeq);
        refs.push({ kind: 'trip', id: c.tripId });
      } else if (c.kind === 'CreateTrip') {
        must(!(await this.db.table('trip_headers').get([space, c.tripId])), 'CONFLICT', '같은 여행이 있습니다.');
        must(
          c.payload.header.domainRevision === 0 && c.payload.initialPlan.number === 1,
          'INVALID_INPUT',
          '초기 여행 기준이 잘못되었습니다.',
        );
        t = {
          domainSchemaVersion: 2,
          header: c.payload.header,
          heads: [],
          contents: [],
          records: [],
          proposals: [],
          plans: [{ ...c.payload.initialPlan, createdAt: now(), commitSeq: seq }],
        };
      } else {
        before = await this.get(c.tripId, space);
        t = structuredClone(before);
        if ('expectedDomainRevision' in c) {
          must(
            c.expectedDomainRevision === t.header.domainRevision,
            'CONFLICT',
            '다른 변경이 저장되었습니다. 입력을 보존하고 최신 내용을 확인하세요.',
          );
        }
        await this.mutate(t, c, seq, refs, space);
        if (c.kind !== 'SaveProposal' && !(c.kind === 'DecideProposal' && c.payload.decision === 'reject')) {
          t.header.domainRevision++;
        }
      }
      t = before ? validateImmutableTransition(before, t) : validateTripDataset(t);
      // Missing old bytes must not prevent field records. New asset revisions still require preparation.
      await this.checkAssets(
        before
          ? {
              ...t,
              contents: t.contents.filter(
                (c) =>
                  c.kind === 'asset' &&
                  !before.contents.some((b) => b.kind === 'asset' && b.payload.hash === c.payload.hash),
              ),
            }
          : t,
        space,
      );
      await this.putDataset(t, space, before);
      m.writeSeq = Math.max(m.writeSeq, seq);
      await this.db.table<Workspace>('workspace_meta').put(m);
      const result: Result = {
        status: 'applied',
        requestId: c.requestId,
        domainRevision: t.header.domainRevision,
        commitSeq: m.writeSeq,
        resultRefs: refs,
      };
      await receipts.add({
        spaceId: space,
        ...receiptSchema.parse({
          tripId: c.tripId,
          requestId: c.requestId,
          kind: c.kind,
          fingerprintVersion: 2,
          fingerprint,
          result,
          commitSeq: m.writeSeq,
          domainRevision: t.header.domainRevision,
          completedAt: now(),
        }),
      });
      return result;
    });
  }
  private async checkAssets(t: TripDataset, space: string) {
    for (const c of t.contents) {
      if (c.kind === 'asset') {
        const blob = await this.db.table('asset_blobs').get([space, t.header.tripId, c.payload.hash]);
        must(
          blob?.verified && blob.byteLength === c.payload.byteLength,
          'MISSING_ASSET',
          '로컬 첨부가 누락되었습니다.',
        );
      }
    }
  }
  private newPlan(
    t: TripDataset,
    operations: Extract<Command, { kind: 'ChangePlan' }>['payload']['operations'],
    reason: string,
    seq: number,
    proposalId?: string,
  ) {
    const previous = t.plans.find((p) => p.planVersionId === t.header.currentPlanVersionId)!;
    const p = structuredClone(previous);
    p.parentId = previous.planVersionId;
    p.planVersionId = uid();
    p.number++;
    p.reason = reason;
    p.commitSeq = seq;
    p.createdAt = now();
    if (proposalId) {
      p.proposalId = proposalId;
    } else {
      delete p.proposalId;
    }
    const touchedStayRanges: StayRange[] = [];
    const noteStayRange = (stay: PlanVersion['stays'][number] | undefined) => {
      const range = stay ? stayRange(stay) : undefined;
      if (range && !isProblem(range)) {
        touchedStayRanges.push(range);
      }
    };
    const dropLegsOf = (activityId: string) => {
      p.legs = p.legs.filter((l) => l.fromActivityId !== activityId && l.toActivityId !== activityId);
    };
    for (const op of operations) {
      switch (op.type) {
        case 'remove-item': {
          must(
            p.items.some((i) => i.activityId === op.activityId),
            'BROKEN_REFERENCE',
            '삭제할 활동이 없습니다.',
          );
          p.items = p.items.filter((i) => i.activityId !== op.activityId);
          // 활동에 연결된 이동은 끝점이 사라지므로 함께 제거한다(화면이 영향 개수를 미리 보여준다).
          dropLegsOf(op.activityId);
          break;
        }
        case 'upsert-item': {
          must(
            op.item.tripId === t.header.tripId && op.item.planVersionId === previous.planVersionId,
            'CONFLICT',
            '활동 기준 계획이 다릅니다.',
          );
          const before = p.items.find((i) => i.activityId === op.item.activityId);
          if (before && before.dayId !== op.item.dayId) {
            // 이동은 같은 날짜의 두 활동 사이에서만 성립하므로, 날짜를 옮기면 연결된 이동이 고아가 되지 않게 함께 제거한다.
            dropLegsOf(op.item.activityId);
          }
          p.items = p.items.filter((i) => i.activityId !== op.item.activityId);
          p.items.push(structuredClone(op.item));
          break;
        }
        case 'upsert-stay': {
          must(
            op.stay.tripId === t.header.tripId && op.stay.planVersionId === previous.planVersionId,
            'CONFLICT',
            '숙박 기준 계획이 다릅니다.',
          );
          const range = stayRange(op.stay);
          must(!isProblem(range), 'INVALID_INPUT', isProblem(range) ? range.problem : '');
          if (op.stay.regionId) {
            const regionId = op.stay.regionId;
            const head = t.heads.find((h) => h.targetKind === 'region' && h.entityId === regionId);
            must(head?.status === 'active', 'BROKEN_REFERENCE', '숙박 지역이 없거나 비활성입니다.');
          }
          if (op.stay.bookingId) {
            const bookingId = op.stay.bookingId;
            must(
              t.heads.some((h) => h.targetKind === 'booking' && h.entityId === bookingId && h.status === 'active'),
              'BROKEN_REFERENCE',
              '숙박 예약이 없거나 비활성입니다.',
            );
          }
          const index = p.stays.findIndex((stay) => stay.stayId === op.stay.stayId);
          if (index >= 0) {
            noteStayRange(p.stays[index]);
            p.stays[index] = structuredClone(op.stay);
          } else {
            p.stays.push(structuredClone(op.stay));
          }
          noteStayRange(op.stay);
          break;
        }
        case 'remove-stay': {
          const existing = p.stays.find((stay) => stay.stayId === op.stayId);
          must(existing, 'BROKEN_REFERENCE', '삭제할 숙박이 없습니다.');
          noteStayRange(existing);
          p.stays = p.stays.filter((stay) => stay.stayId !== op.stayId);
          break;
        }
        case 'upsert-leg': {
          must(
            op.leg.tripId === t.header.tripId && op.leg.planVersionId === previous.planVersionId,
            'CONFLICT',
            '이동 기준 계획이 다릅니다.',
          );
          const { fromActivityId, toActivityId, dayId } = op.leg;
          must(fromActivityId !== toActivityId, 'INVALID_INPUT', '출발과 도착 활동이 같습니다.');
          must(
            [fromActivityId, toActivityId].every((id) => p.items.some((i) => i.activityId === id && i.dayId === dayId)),
            'BROKEN_REFERENCE',
            '이동의 출발·도착 활동은 같은 날짜에 있어야 합니다.',
          );
          p.legs = p.legs.filter((leg) => leg.legId !== op.leg.legId);
          p.legs.push(structuredClone(op.leg));
          break;
        }
        case 'remove-leg': {
          must(
            p.legs.some((leg) => leg.legId === op.legId),
            'BROKEN_REFERENCE',
            '삭제할 이동이 없습니다.',
          );
          p.legs = p.legs.filter((leg) => leg.legId !== op.legId);
          break;
        }
      }
    }
    // 숙박이 바뀐 날짜(이전·새 기간의 합집합)만 하루 지역·야간 지역을 다시 계산한다. 다른 날과 필드는 그대로 둔다.
    if (touchedStayRanges.length) {
      for (const day of p.days) {
        if (!touchedStayRanges.some((range) => range.checkin <= day.date && day.date <= range.checkout)) {
          continue;
        }
        const regions = dayRegionsFromStays(p.stays, day.date);
        must(!isProblem(regions), 'INVALID_INPUT', isProblem(regions) ? regions.problem : '');
        day.regionIds = regions.regionIds;
        if (regions.overnightRegionId) {
          day.overnightRegionId = regions.overnightRegionId;
        } else {
          delete day.overnightRegionId;
        }
      }
    }
    p.items = retarget(p.items, t) as PlanVersion['items'];
    for (const row of [...p.days, ...p.items, ...p.legs, ...p.stays]) {
      row.planVersionId = p.planVersionId;
    }
    p.contextRefs = t.heads.map((h) => {
      const c = t.contents.find(
        (c) => c.kind === h.targetKind && c.entityId === h.entityId && c.revisionId === h.revisionId,
      )!;
      return {
        tripId: c.tripId,
        targetKind: c.kind,
        entityId: c.entityId,
        revisionId: c.revisionId,
        ...(c.kind === 'asset' ? { hash: c.payload.hash } : {}),
      };
    });
    t.plans.push(p);
    t.header.currentPlanVersionId = p.planVersionId;
    return p;
  }
  private async mutate(t: TripDataset, c: Command, seq: number, refs: Result['resultRefs'], space: string) {
    const putContent = (content: ContentRevision, expected: string) => {
      const head = t.heads.find((h) => h.targetKind === content.kind && h.entityId === content.entityId);
      must(head?.revisionId === expected, 'CONFLICT', '콘텐츠 revision이 변경되었습니다.');
      must(
        content.previousRevisionId === expected && content.revisionId !== expected,
        'INVALID_INPUT',
        '새 revision과 이전 연결이 필요합니다.',
      );
      t.contents.push(content);
      head.revisionId = content.revisionId;
      refs.push({ kind: content.kind, id: content.entityId, revisionId: content.revisionId });
    };
    switch (c.kind) {
      case 'EditContentSection': {
        const a = c.payload.target;
        must(a.targetKind === 'guide', 'INVALID_INPUT', '가이드 섹션만 편집합니다.');
        const old = t.contents.find(
          (r) => r.kind === 'guide' && r.entityId === a.entityId && r.revisionId === a.revisionId,
        );
        must(old?.kind === 'guide', 'NOT_FOUND', '가이드가 없습니다.');
        must(
          old.payload.sections.some((s) => s.key === c.payload.section.key),
          'INVALID_INPUT',
          '기존 섹션이 아닙니다.',
        );
        const revisionId = uid();
        const next = {
          ...structuredClone(old),
          revisionId,
          previousRevisionId: old.revisionId,
          commitSeq: seq,
          recordedAt: now(),
          actor: 'user' as const,
        };
        next.payload.sections = next.payload.sections.map((s) =>
          s.key === c.payload.section.key ? c.payload.section : s,
        );
        putContent(next, a.revisionId);
        break;
      }
      case 'UpdateContent': {
        const next = contentRevisionSchema.parse({
          ...c.payload.content,
          commitSeq: seq,
          recordedAt: now(),
          actor: 'user',
        });
        const previous = t.contents.find(
          (r) => r.kind === next.kind && r.entityId === next.entityId && r.revisionId === c.payload.expectedRevisionId,
        );
        const head = t.heads.find((h) => h.targetKind === next.kind && h.entityId === next.entityId);
        // 기준 revision이 현재 head가 아니면 아래 putContent가 CONFLICT로 거부한다.
        if (previous && head?.revisionId === previous.revisionId) {
          guardContentUpdate(t, previous, next, (code, message) => {
            throw new RepositoryError(code, message);
          });
        }
        putContent(next, c.payload.expectedRevisionId);
        break;
      }
      case 'SetBookingState':
        putContent(
          contentRevisionSchema.parse({ ...c.payload.booking, commitSeq: seq, recordedAt: now(), actor: 'user' }),
          c.payload.expectedRevisionId,
        );
        break;
      case 'CreateContentBatch':
        applyContentBatch(t, c.payload, seq, now(), refs, (code, message) => {
          throw new RepositoryError(code, message);
        });
        break;
      case 'DeactivateContent': {
        const h = t.heads.find(
          (h) => h.targetKind === c.payload.target.targetKind && h.entityId === c.payload.target.entityId,
        );
        must(h?.revisionId === c.payload.target.revisionId, 'CONFLICT', '콘텐츠 기준이 변경되었습니다.');
        h.status = 'inactive';
        break;
      }
      case 'UpdateTripMetadata':
        Object.assign(t.header, c.payload);
        break;
      case 'ChangePlan':
        must(c.payload.currentPlanVersionId === t.header.currentPlanVersionId, 'CONFLICT', '계획이 변경되었습니다.');
        refs.push({ kind: 'plan', id: this.newPlan(t, c.payload.operations, c.payload.reason, seq).planVersionId });
        break;
      case 'RecordActual':
      case 'CorrectActual':
      case 'AddNote':
      case 'SetTaskState': {
        const row = { ...c.payload.record, commitSeq: seq, recordedAt: now() } as FieldRecord;
        if (row.supersedes) {
          must(
            t.records.some((r) => r.recordId === row.supersedes && r.kind === row.kind) &&
              !t.records.some((r) => r.supersedes === row.supersedes),
            'CONFLICT',
            '정정 대상이 이미 변경되었습니다.',
          );
        }
        t.records.push(row);
        refs.push({ kind: 'record', id: row.recordId });
        break;
      }
      case 'StageAiProposal':
      case 'SaveProposal': {
        const p = c.payload.proposal;
        if (c.kind === 'StageAiProposal') {
          must(
            p.baseDomainRevision === t.header.domainRevision + 1 &&
              p.basePlanVersionId === t.header.currentPlanVersionId,
            'CONFLICT',
            'AI 초안의 기준 계획이 변경되었습니다. 최신 내용으로 다시 요청하세요.',
          );
          must(!t.proposals.some((row) => row.proposalId === p.proposalId), 'CONFLICT', '이미 저장한 AI 초안입니다.');
          must(
            p.evidenceRefs.length > 0 &&
              p.evidenceRefs.every((ref) =>
                c.payload.evidence.some(
                  (content) => content.entityId === ref.entityId && content.revisionId === ref.revisionId,
                ),
              ),
            'INVALID_INPUT',
            'AI 초안의 근거가 함께 저장할 출처와 일치하지 않습니다.',
          );
          const currentPlan = t.plans.find((plan) => plan.planVersionId === t.header.currentPlanVersionId)!;
          for (const operation of p.operations) {
            if (operation.type !== 'upsert-item') {
              continue;
            }
            const original = currentPlan.items.find((item) => item.activityId === operation.item.activityId);
            // These private fields were deliberately omitted from the API context.
            if (original?.reservationText !== undefined) {
              operation.item.reservationText = original.reservationText;
            }
            if (original?.executionNote !== undefined) {
              operation.item.executionNote = original.executionNote;
            }
          }
          for (const raw of c.payload.evidence) {
            const evidence = contentRevisionSchema.parse({ ...raw, actor: 'ai', recordedAt: now(), commitSeq: seq });
            must(
              evidence.kind === 'evidence' &&
                !evidence.previousRevisionId &&
                !t.heads.some((head) => head.targetKind === evidence.kind && head.entityId === evidence.entityId),
              'CONFLICT',
              'AI 근거 ID가 기존 콘텐츠와 충돌합니다.',
            );
            t.contents.push(evidence);
            t.heads.push({
              tripId: t.header.tripId,
              targetKind: evidence.kind,
              entityId: evidence.entityId,
              revisionId: evidence.revisionId,
              status: 'active',
            });
            refs.push({ kind: evidence.kind, id: evidence.entityId, revisionId: evidence.revisionId });
          }
        }
        const previous = t.proposals
          .filter((r) => r.proposalId === p.proposalId)
          .sort((a, b) => b.proposalRevision - a.proposalRevision)[0];
        must(
          (previous?.proposalRevision ?? 0) === (c.kind === 'StageAiProposal' ? 0 : c.expectedProposalRevision),
          'CONFLICT',
          '초안 revision이 변경되었습니다.',
        );
        must(!previous || previous.status === 'pending', 'NOT_PENDING', '이미 결정한 초안입니다.');
        must(
          p.proposalRevision === (c.kind === 'StageAiProposal' ? 1 : c.expectedProposalRevision + 1) &&
            p.previousProposalRevisionId === previous?.proposalRevisionId,
          'INVALID_INPUT',
          '초안 연결이 잘못되었습니다.',
        );
        t.proposals.push({ ...p, commitSeq: seq });
        refs.push({ kind: 'proposal', id: p.proposalId, revisionId: p.proposalRevisionId });
        break;
      }
      case 'DecideProposal': {
        const previous = t.proposals
          .filter((r) => r.proposalId === c.payload.proposalId)
          .sort((a, b) => b.proposalRevision - a.proposalRevision)[0];
        must(previous?.status === 'pending', 'NOT_PENDING', '결정 대기 초안이 아닙니다.');
        must(previous.proposalRevision === c.expectedProposalRevision, 'CONFLICT', '초안이 변경되었습니다.');
        const p: Proposal = {
          ...structuredClone(previous),
          proposalRevision: previous.proposalRevision + 1,
          proposalRevisionId: uid(),
          previousProposalRevisionId: previous.proposalRevisionId,
          status: c.payload.decision === 'apply' ? 'applied' : 'rejected',
          decision: { actor: 'user', action: c.payload.decision, decidedAt: now() },
          commitSeq: seq,
        };
        if (c.payload.decision === 'apply') {
          must(
            previous.baseDomainRevision === t.header.domainRevision &&
              previous.basePlanVersionId === t.header.currentPlanVersionId,
            'CONFLICT',
            '오래된 변경안입니다. 최신 내용으로 다시 작성하세요.',
          );
          p.resultPlanVersionId = this.newPlan(t, p.operations, p.reason, seq, p.proposalId).planVersionId;
          refs.push({ kind: 'plan', id: p.resultPlanVersionId });
        }
        t.proposals.push(p);
        refs.push({ kind: 'proposal', id: p.proposalId, revisionId: p.proposalRevisionId });
        break;
      }
      case 'ApplyReimport':
        await this.applyReimport(t, c, seq, refs, space);
        break;
      default:
        throw new RepositoryError('INVALID_INPUT', '지원하지 않는 변경 명령.');
    }
  }
  private async applyReimport(
    t: TripDataset,
    c: Extract<Command, { kind: 'ApplyReimport' }>,
    seq: number,
    refs: Result['resultRefs'],
    space: string,
  ): Promise<void> {
    const job = (await this.db.table<Reviewed>('transfer_jobs').where('spaceId').equals(space).toArray()).find(
      (j) =>
        j.tripId === t.header.tripId &&
        j.provenance.packageId === c.payload.packageId &&
        j.provenance.packageDigest === c.payload.packageDigest &&
        j.reviewDigest === c.payload.reviewDigest,
    );
    must(
      job?.review && job.choices && job.provenance.lineageId === c.payload.lineageId,
      'INVALID_INPUT',
      '검토 digest가 일치하지 않습니다.',
    );
    const baseline = await this.baselines(space, t.header.tripId, c.payload.lineageId),
      review = compareReimport(t, job.provenance.mappings, baseline, {
        jobId: job.jobId,
        lineageId: c.payload.lineageId,
        packageId: job.provenance.packageId,
        packageDigest: job.provenance.packageDigest,
      });
    must(canonicalJson(review) === canonicalJson(job.review), 'CONFLICT', '검토 기준이 변경되었습니다.');
    const selected: ImportMapping[] = [],
      newRows: ContentRevision[] = [];
    let planPayload: unknown;
    const remotePlanId = job.dataset.header.currentPlanVersionId;
    for (const key of new Set(review.units.filter((u) => job.choices![u.key] === 'remote').map((u) => u.mappingKey))) {
      const original = baseline.find((m) => mappingKey(m) === key),
        remote = job.provenance.mappings.find((m) => mappingKey(m) === key),
        mapping = remote ?? original!;
      let local: unknown = localPayload(t, mapping),
        base: unknown = original?.baselineValue === null ? undefined : original?.baselineValue;
      for (const unit of review.units.filter((u) => u.mappingKey === key && job.choices![u.key] === 'remote')) {
        local = patchValue(local, unit.path, unit.remote);
        base = patchValue(base, unit.path, unit.remote);
      }
      selected.push({ ...mapping, baselineValue: base ?? null });
      if (mapping.targetKind === 'plan') {
        must(local, 'INVALID_INPUT', '계획 전체 삭제는 지원하지 않습니다.');
        planPayload = local;
        continue;
      }
      if (mapping.targetKind === 'trip') {
        must(local, 'INVALID_INPUT', '여행 삭제는 지원하지 않습니다.');
        Object.assign(t.header, local);
        continue;
      }
      const head = t.heads.find((h) => h.targetKind === mapping.targetKind && h.entityId === mapping.entityId);
      if (local === undefined) {
        must(head, 'BROKEN_REFERENCE', '삭제 대상이 없습니다.');
        head.status = 'inactive';
        continue;
      }
      const previous = head
        ? t.contents.find(
            (r) => r.kind === head.targetKind && r.entityId === head.entityId && r.revisionId === head.revisionId,
          )
        : undefined;
      const sourceRow = job.dataset.contents.find(
        (r) =>
          r.kind === mapping.targetKind &&
          r.entityId === mapping.entityId &&
          r.revisionId ===
            job.dataset.heads.find((h) => h.targetKind === mapping.targetKind && h.entityId === mapping.entityId)
              ?.revisionId,
      );
      must(previous || sourceRow, 'BROKEN_REFERENCE', '대상 콘텐츠가 없습니다.');
      const row = {
        ...(previous ?? sourceRow!),
        payload: local,
        revisionId: uid(),
        ...(previous ? { previousRevisionId: previous.revisionId } : {}),
        recordedAt: now(),
        actor: 'import',
        commitSeq: seq,
      } as ContentRevision;
      if (!previous) {
        delete row.previousRevisionId;
      }
      t.contents.push(row);
      newRows.push(row);
      if (head) {
        head.revisionId = row.revisionId;
        head.status = 'active';
      } else {
        t.heads.push({
          tripId: t.header.tripId,
          targetKind: row.kind,
          entityId: row.entityId,
          revisionId: row.revisionId,
          status: 'active',
        });
      }
      refs.push({ kind: row.kind, id: row.entityId, revisionId: row.revisionId });
    }
    let newPlan: PlanVersion | undefined;
    if (planPayload) {
      const previous = t.plans.find((p) => p.planVersionId === t.header.currentPlanVersionId)!;
      const parts = planPayload as Pick<PlanVersion, 'days' | 'items' | 'legs' | 'stays'>;
      newPlan = {
        ...structuredClone(previous),
        ...structuredClone(parts),
        planVersionId: uid(),
        parentId: previous.planVersionId,
        number: previous.number + 1,
        createdAt: now(),
        reason: '확인한 원본 계획 반영',
        commitSeq: seq,
      };
      delete newPlan.proposalId;
      for (const row of [...newPlan.days, ...newPlan.items, ...newPlan.legs, ...newPlan.stays]) {
        row.planVersionId = newPlan.planVersionId;
      }
      t.plans.push(newPlan);
      t.header.currentPlanVersionId = newPlan.planVersionId;
      refs.push({ kind: 'plan', id: newPlan.planVersionId });
    }
    for (const row of newRows) {
      row.payload = retarget(row.payload, t, remotePlanId, newPlan?.planVersionId) as ContentRevision['payload'];
    }
    if (newPlan) {
      newPlan.items = retarget(newPlan.items, t) as PlanVersion['items'];
      newPlan.contextRefs = t.heads.map((h) => {
        const row = t.contents.find(
          (r) => r.kind === h.targetKind && r.entityId === h.entityId && r.revisionId === h.revisionId,
        )!;
        return {
          tripId: row.tripId,
          targetKind: row.kind,
          entityId: row.entityId,
          revisionId: row.revisionId,
          ...(row.kind === 'asset' ? { hash: row.payload.hash } : {}),
        };
      });
    }
    await this.importRows(space, t, job.provenance, seq, selected);
  }
}
