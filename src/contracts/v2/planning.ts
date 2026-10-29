import { z } from 'zod';
import {
  assetRef,
  contentRef,
  date,
  id,
  instant,
  positive,
  revisionRef,
  sha256,
  sourceRef,
  targetRef,
  text,
  timeZone,
  uint,
  webUrl,
} from './primitives.ts';
import { timeRangeSchema, timeSpecSchema } from './time.ts';

export const tripHeaderSchema = z
  .strictObject({
    tripId: id,
    name: text,
    startDate: date,
    endDate: date,
    defaultTimeZone: timeZone.optional(),
    timeZoneStatus: z.enum(['confirmed', 'unknown']),
    domainRevision: uint,
    currentPlanVersionId: id,
    sourceMetadata: z
      .strictObject({ days: uint.optional(), nights: uint.optional(), inflightNights: uint.optional() })
      .optional(),
  })
  .superRefine((t, ctx) => {
    if (t.endDate < t.startDate) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: '여행 종료일이 시작일보다 이릅니다.' });
    }
    if ((t.timeZoneStatus === 'confirmed') !== Boolean(t.defaultTimeZone)) {
      ctx.addIssue({ code: 'custom', path: ['timeZoneStatus'], message: '시간대 확인 상태가 값과 다릅니다.' });
    }
  });
const row = { tripId: id, planVersionId: id };
export const planDaySchema = z.strictObject({
  ...row,
  dayId: id,
  ordinal: positive,
  date,
  cityText: z.string(),
  title: text,
  dayType: z.string().optional(),
  regionIds: z.array(id),
  overnightRegionId: id.optional(),
  fatigueText: z.string().optional(),
  time: timeRangeSchema,
  durationText: z.string().optional(),
  distanceText: z.string().optional(),
  transport: z.array(z.string()),
  food: z.array(z.string()),
  highlights: z.array(z.string()),
  backupText: z.string().optional(),
  needsReview: z.array(z.string()),
  sourceStatus: z.string().optional(),
  sourceMetadata: z
    .strictObject({
      prototypeType: z.string().optional(),
      mapCenter: z.tuple([z.number(), z.number()]).optional(),
      mapZoom: z.number().finite().optional(),
    })
    .optional(),
  assetRefs: z.array(assetRef),
});
export const planItemSchema = z.strictObject({
  ...row,
  activityId: id,
  dayId: id,
  order: uint,
  title: text,
  category: text,
  time: timeRangeSchema,
  summary: z.string(),
  menuText: z.string().optional(),
  reservationText: z.string().optional(),
  optional: z.boolean(),
  placeLinks: z.array(z.strictObject({ placeId: id, relation: z.enum(['visit', 'context', 'transit', 'nearby']) })),
  mapTargetId: id.optional(),
  bookingIds: z.array(id),
  taskRefs: z.array(revisionRef.refine((r) => r.targetKind === 'task')),
  executionMarkers: z.array(z.strictObject({ type: text, detail: z.string(), label: z.string() })),
  executionNote: z.string().optional(),
  officialUrl: webUrl.optional(),
  sourceFlags: z.array(z.string()),
});
export const planLegSchema = z.strictObject({
  ...row,
  legId: id,
  dayId: id,
  fromActivityId: id,
  toActivityId: id,
  mode: text,
  durationText: z.string().optional(),
  distanceText: z.string().optional(),
  lineText: z.string().optional(),
  geometryStatus: z.string().optional(),
  geometryAssetId: id.optional(),
  mapTargetId: id.optional(),
});
export const planStaySchema = z.strictObject({
  ...row,
  stayId: id,
  regionId: id.optional(),
  baseText: text,
  time: timeRangeSchema,
  plannedNights: uint.optional(),
  bookingId: id.optional(),
  locationStatus: z.string().optional(),
});
export const planVersionSchema = z.strictObject({
  ...row,
  number: positive,
  parentId: id.optional(),
  reason: text,
  createdAt: instant,
  proposalId: id.optional(),
  contextRefs: z.array(revisionRef),
  commitSeq: positive,
  days: z.array(planDaySchema),
  items: z.array(planItemSchema),
  legs: z.array(planLegSchema),
  stays: z.array(planStaySchema),
});
const fieldCommon = {
  tripId: id,
  recordId: id,
  recordedAt: instant,
  supersedes: id.optional(),
  sourceRefs: z.array(sourceRef),
  commitSeq: positive,
};
export const fieldRecordSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...fieldCommon,
    kind: z.literal('actual'),
    payload: z.strictObject({
      title: text,
      targetSummary: z.string(),
      outcome: z.enum(['visited', 'skipped', 'unplanned']),
      time: timeRangeSchema,
      note: z.string(),
      placeRef: contentRef.refine((r) => r.targetKind === 'place').optional(),
      planVersionId: id.optional(),
      activityId: id.optional(),
      contextRefs: z.array(revisionRef),
    }),
  }),
  z.strictObject({
    ...fieldCommon,
    kind: z.literal('note'),
    payload: z.strictObject({ targetRef, body: text, contextRefs: z.array(revisionRef) }),
  }),
  z.strictObject({
    ...fieldCommon,
    kind: z.literal('task-state'),
    payload: z.strictObject({
      taskRef: revisionRef.refine((r) => r.targetKind === 'task'),
      meaningFingerprint: sha256,
      completed: z.boolean(),
      contextRefs: z.array(revisionRef),
    }),
  }),
  z.strictObject({
    ...fieldCommon,
    kind: z.literal('legacy-state'),
    payload: z.strictObject({
      targetRef,
      state: z.enum(['visited', 'not-visited', 'checked', 'unchecked']),
      sourceKey: text,
      originalTime: timeSpecSchema.optional(),
      note: z.string(),
    }),
  }),
]);
export const planOperationSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('upsert-item'), item: planItemSchema }),
  z.strictObject({ type: z.literal('remove-item'), activityId: id }),
]);
// 계획 편집 명령(ChangePlan)만 숙박·이동 연산을 받는다. 변경안·AI 경계(planOperationSchema)는 항목 연산에 머문다.
export const planEditOperationSchema = z.discriminatedUnion('type', [
  ...planOperationSchema.options,
  z.strictObject({ type: z.literal('upsert-stay'), stay: planStaySchema }),
  z.strictObject({ type: z.literal('remove-stay'), stayId: id }),
  z.strictObject({ type: z.literal('upsert-leg'), leg: planLegSchema }),
  z.strictObject({ type: z.literal('remove-leg'), legId: id }),
]);
export const proposalSchema = z
  .strictObject({
    tripId: id,
    proposalId: id,
    proposalRevisionId: id,
    previousProposalRevisionId: id.optional(),
    proposalRevision: positive,
    baseDomainRevision: uint,
    basePlanVersionId: id,
    origin: z.enum(['ai', 'user', 'import']),
    operations: z.array(planOperationSchema).min(1),
    reason: text,
    evidenceRefs: z.array(revisionRef.refine((r) => r.targetKind === 'evidence')),
    impact: z.strictObject({ activityIds: z.array(id), reservationText: text }),
    status: z.enum(['pending', 'applied', 'rejected']),
    decision: z
      .strictObject({ action: z.enum(['apply', 'reject']), actor: z.literal('user'), decidedAt: instant })
      .optional(),
    resultPlanVersionId: id.optional(),
    commitSeq: positive,
  })
  .superRefine((p, ctx) => {
    if (
      p.status === 'pending'
        ? p.decision !== undefined || p.resultPlanVersionId !== undefined
        : !p.decision ||
          p.decision.action !== (p.status === 'applied' ? 'apply' : 'reject') ||
          (p.status === 'applied') !== Boolean(p.resultPlanVersionId)
    ) {
      ctx.addIssue({ code: 'custom', path: ['decision'], message: '변경안 상태·사용자 결정·결과가 일치해야 합니다.' });
    }
  });
export type PlanVersion = z.infer<typeof planVersionSchema>;
export type FieldRecord = z.infer<typeof fieldRecordSchema>;
export type Proposal = z.infer<typeof proposalSchema>;
