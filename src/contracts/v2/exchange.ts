import { z } from 'zod';
import {
  contentKind,
  date,
  ensure,
  id,
  instant,
  positive,
  revisionRef,
  sha256,
  text,
  uint,
  unique,
} from './primitives.ts';
import { contentRevisionSchema, sectionSchema } from './content.ts';
import {
  fieldRecordSchema,
  planOperationSchema,
  planVersionSchema,
  proposalSchema,
  tripHeaderSchema,
} from './planning.ts';
import { canonicalJson, digestBytes, parseStrictJson } from './json.ts';
import { timeRangeReversal } from './time.ts';

const packageInput = z.strictObject({ packageId: id, packageDigest: sha256 });
const update = { expectedDomainRevision: uint };
type InputRow<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
// Storage-assigned sequence/timestamps/actor must not enter caller fingerprints.
const contentInputSchema = z.union(
  contentRevisionSchema.options.map((s) => s.omit({ commitSeq: true, recordedAt: true, actor: true })),
) as z.ZodType<InputRow<z.infer<typeof contentRevisionSchema>, 'commitSeq' | 'recordedAt' | 'actor'>>;
const recordInputSchema = z.union(
  fieldRecordSchema.options.map((s) => s.omit({ commitSeq: true, recordedAt: true })),
) as z.ZodType<InputRow<z.infer<typeof fieldRecordSchema>, 'commitSeq' | 'recordedAt'>>;
const { commitSeq: _proposalCommitSeq, ...proposalInputShape } = proposalSchema.shape;
const proposalInputSchema = z.strictObject(proposalInputShape).superRefine((p, ctx) => {
  const checked = proposalSchema.safeParse({ ...p, commitSeq: 1 });
  if (!checked.success) {
    checked.error.issues.forEach((issue) => ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message }));
  }
});
const envelope = {
  format: z.literal('travel-app-command'),
  commandVersion: z.literal(2),
  tripId: id,
  requestId: id,
  normalizationVersion: text,
};
const command = <K extends string, S extends z.ZodType, P extends z.ZodRawShape = {}>(
  kind: K,
  payload: S,
  preconditions: P = {} as P,
) => z.strictObject({ ...envelope, kind: z.literal(kind), ...preconditions, payload });
// Authoring batches only create or relink region/place/guide documents; they are not a general content write API.
const authoredKinds = ['region', 'place', 'guide'];
const authoredInput = contentInputSchema.refine((content) => authoredKinds.includes(content.kind));
const ownerInput = contentInputSchema.refine((content) => content.kind === 'region' || content.kind === 'place');
const contentBase = z.strictObject({ targetKind: contentKind, entityId: id, revisionId: id });
export const commandSchema = z.discriminatedUnion('kind', [
  command(
    'CreateTrip',
    z.strictObject({
      header: tripHeaderSchema,
      initialPlan: planVersionSchema.omit({ commitSeq: true, createdAt: true }),
    }),
  ),
  command('ImportNewTrip', packageInput),
  command('EditContentSection', z.strictObject({ target: contentBase, section: sectionSchema }), update),
  command('UpdateContent', z.strictObject({ expectedRevisionId: id, content: contentInputSchema }), update),
  command(
    'ChangePlan',
    z.strictObject({ currentPlanVersionId: id, operations: z.array(planOperationSchema).min(1), reason: text }),
    update,
  ),
  command(
    'RecordActual',
    z.strictObject({ record: recordInputSchema.refine((r) => r.kind === 'actual' && !r.supersedes) }),
    update,
  ),
  command(
    'CorrectActual',
    z.strictObject({
      supersedes: id,
      record: recordInputSchema.refine((r) => r.kind === 'actual' && Boolean(r.supersedes)),
    }),
    update,
  ),
  command('AddNote', z.strictObject({ record: recordInputSchema.refine((r) => r.kind === 'note') }), update),
  command(
    'SetBookingState',
    z.strictObject({ expectedRevisionId: id, booking: contentInputSchema.refine((r) => r.kind === 'booking') }),
    update,
  ),
  command('SetTaskState', z.strictObject({ record: recordInputSchema.refine((r) => r.kind === 'task-state') }), update),
  command(
    'SaveProposal',
    z.strictObject({ proposal: proposalInputSchema.refine((p) => p.status === 'pending'), baseDomainRevision: uint }),
    { expectedProposalRevision: uint },
  ),
  command(
    'StageAiProposal',
    z.strictObject({
      proposal: proposalInputSchema.refine(
        (proposal) => proposal.status === 'pending' && proposal.origin === 'ai' && proposal.proposalRevision === 1,
      ),
      evidence: z
        .array(contentInputSchema.refine((content) => content.kind === 'evidence'))
        .min(1)
        .max(20),
    }),
    update,
  ),
  command(
    'DecideProposal',
    z.strictObject({ proposalId: id, decision: z.enum(['apply', 'reject']), confirmedByUser: z.literal(true) }),
    { expectedProposalRevision: positive },
  ),
  command(
    'CreateContentBatch',
    z.strictObject({
      create: z.array(authoredInput).min(1).max(20),
      updateOwners: z.array(z.strictObject({ expectedRevisionId: id, content: ownerInput })).max(20),
    }),
    update,
  ),
  command('ApplyReimport', packageInput.extend({ reviewDigest: sha256, lineageId: id }), update),
  command('UpdateTripMetadata', z.strictObject({ name: text, startDate: date, endDate: date }), update),
  command('DeactivateContent', z.strictObject({ target: contentBase }), update),
]);
export type Command = z.infer<typeof commandSchema>;
export function validateCommand(raw: unknown): Command {
  // Reject non-JSON inputs before Zod can omit optional undefined fields.
  canonicalJson(raw);
  const c = commandSchema.parse(raw);
  const walk = (v: unknown) => {
    if (!v || typeof v !== 'object') {
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    const obj = v as Record<string, unknown>;
    // 가져온 원천의 시간 범위가 든 다른 명령(예약 상태 등)은 막지 않고, 계획 편집만 새 규칙으로 검사한다.
    if (c.kind === 'ChangePlan' && obj.time && typeof obj.time === 'object' && 'start' in obj.time) {
      const reversed = timeRangeReversal(obj.time as Parameters<typeof timeRangeReversal>[0]);
      ensure(!reversed, 'command.time', reversed ?? '', 'INVALID_INPUT');
    }
    if ('tripId' in obj) {
      ensure(obj.tripId === c.tripId, 'command.payload.tripId', '다른 여행의 입력입니다.', 'BROKEN_REFERENCE');
    }
    Object.values(obj).forEach(walk);
  };
  walk(c.payload);
  if (c.kind === 'CorrectActual') {
    ensure(c.payload.supersedes === c.payload.record.supersedes, 'command.supersedes', '정정 대상이 다릅니다.');
  }
  if (c.kind === 'SaveProposal') {
    ensure(
      c.payload.baseDomainRevision === c.payload.proposal.baseDomainRevision,
      'command.baseDomainRevision',
      '초안 기준이 다릅니다.',
    );
  }
  if (c.kind === 'UpdateTripMetadata') {
    ensure(c.payload.startDate <= c.payload.endDate, 'command.endDate', '기간 역순입니다.');
  }
  return c;
}
export async function commandFingerprint(raw: unknown) {
  return digestBytes(new TextEncoder().encode(canonicalJson(validateCommand(raw))));
}

export const exchangeCollections = [
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
export const LIMITS = {
  zipBytes: 256 * 1024 ** 2,
  uncompressedBytes: 512 * 1024 ** 2,
  files: 10_000,
  manifestBytes: 4 * 1024 ** 2,
  assetBytes: 64 * 1024 ** 2,
  recordBytes: 512 * 1024,
  provenanceBytes: 16 * 1024 ** 2,
  records: 100_000,
  commandRows: 10_000,
  commandBytes: 32 * 1024 ** 2,
} as const;
// A package provenance row contains baselines for many entities; content rows keep the smaller budget.
export const recordByteLimit = (collection: string) =>
  collection === 'import_packages' ? LIMITS.provenanceBytes : LIMITS.recordBytes;
export const fileEntrySchema = z
  .strictObject({
    path: text,
    role: z.enum(['records', 'asset', 'report']),
    byteLength: uint,
    sha256,
    collection: z.enum(exchangeCollections).optional(),
    recordCount: uint.optional(),
  })
  .superRefine((f, ctx) => {
    const expectedPath =
      f.role === 'records'
        ? `records/${f.collection}.ndjson`
        : f.role === 'asset'
          ? `assets/sha256/${f.sha256}`
          : 'reports/import-report.json';
    if (
      f.path !== expectedPath ||
      f.path.includes('\\') ||
      (f.role === 'records') !== (f.collection !== undefined && f.recordCount !== undefined)
    ) {
      ctx.addIssue({ code: 'custom', path: ['path'], message: '허용된 경로·collection·레코드 수 조합이 아닙니다.' });
    }
    if (f.role !== 'records' && (f.collection !== undefined || f.recordCount !== undefined)) {
      ctx.addIssue({ code: 'custom', message: '레코드 메타데이터는 records에만 허용합니다.' });
    }
    if (f.role === 'asset' && f.byteLength > LIMITS.assetBytes) {
      ctx.addIssue({ code: 'custom', message: '단일 첨부 한도 초과.' });
    }
  });
const source = z.strictObject({
  sourceRepository: text,
  sourceCommit: text,
  lineageId: id,
  adapterVersion: text,
  normalizationVersion: text,
});
const common = {
  version: z.literal(2),
  domainSchemaVersion: z.literal(2),
  createdAt: instant,
  files: z.array(fileEntrySchema).max(LIMITS.files),
};
export const manifestSchema = z
  .discriminatedUnion('format', [
    z.strictObject({
      ...common,
      format: z.literal('travel-app-package'),
      packageId: id,
      purpose: z.enum(['migration', 'trip-transfer']),
      source,
      tripIds: z.array(id).length(1),
    }),
    z.strictObject({
      ...common,
      format: z.literal('travel-app-backup'),
      snapshotId: id,
      cutSeq: uint,
      tripIds: z.array(id),
    }),
  ])
  .superRefine((m, ctx) => {
    if (new Set(m.files.map((f) => f.path.toLowerCase())).size !== m.files.length) {
      ctx.addIssue({ code: 'custom', path: ['files'], message: '중복/대소문자 충돌 경로.' });
    }
    if (new Set(m.tripIds).size !== m.tripIds.length) {
      ctx.addIssue({ code: 'custom', path: ['tripIds'], message: '중복 여행 ID.' });
    }
    if (
      m.files.reduce((n, f) => n + f.byteLength, 0) > LIMITS.uncompressedBytes ||
      m.files.reduce((n, f) => n + (f.recordCount ?? 0), 0) > LIMITS.records
    ) {
      ctx.addIssue({ code: 'custom', path: ['files'], message: '해제 크기/레코드 합계 한도 초과.' });
    }
  });
export const sourceExtractSchema = z.strictObject({
  format: z.literal('travel-app-source-extract'),
  version: z.literal(1),
  sourceRepository: text,
  sourceCommit: text,
  adapter: text,
  extractorVersion: text,
  manifest: z.array(z.strictObject({ path: text, byteLength: uint, sha256 })),
  entries: z.array(
    z.strictObject({
      sourceKind: text,
      sourceKey: text,
      locator: text,
      rawValue: z.json(),
      status: z.enum(['extracted', 'unresolved']),
      issue: z.string().optional(),
    }),
  ),
  unresolved: z.array(z.strictObject({ sourceKey: text, reason: text })),
});
export const receiptSchema = z
  .strictObject({
    tripId: id,
    requestId: id,
    kind: z.enum(commandSchema.options.map((o) => o.shape.kind.value) as [Command['kind'], ...Command['kind'][]]),
    fingerprintVersion: z.literal(2),
    fingerprint: sha256,
    commitSeq: positive,
    domainRevision: uint,
    completedAt: instant,
    result: z.strictObject({
      status: z.literal('applied'),
      requestId: id,
      domainRevision: uint,
      commitSeq: positive,
      resultRefs: z.array(
        z.strictObject({
          kind: z.enum([...contentKind.options, 'trip', 'plan', 'record', 'proposal']),
          id,
          revisionId: id.optional(),
        }),
      ),
    }),
  })
  .superRefine((r, ctx) => {
    if (
      r.requestId !== r.result.requestId ||
      r.commitSeq !== r.result.commitSeq ||
      r.domainRevision !== r.result.domainRevision
    ) {
      ctx.addIssue({ code: 'custom', path: ['result'], message: '영수증과 저장 결과의 기준이 다릅니다.' });
    }
  });

export function parseCommandJson(input: string) {
  return validateCommand(parseStrictJson(input, LIMITS.commandBytes));
}
export function parseManifestJson(input: string) {
  return manifestSchema.parse(parseStrictJson(input, LIMITS.manifestBytes));
}
export function validateManifestPaths(paths: string[], manifest: z.infer<typeof manifestSchema>) {
  unique(
    paths.map((p) => p.toLowerCase()),
    'zip.entries',
  );
  const allowed = new Set(['manifest.json', ...manifest.files.map((f) => f.path)]);
  ensure(
    paths.length === allowed.size && paths.every((p) => allowed.has(p)),
    'zip.entries',
    'manifest와 ZIP entry가 일치하지 않습니다.',
    'BROKEN_REFERENCE',
  );
}
