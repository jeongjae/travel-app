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
  uint,
  webUrl,
} from './primitives.ts';
import { timeRangeSchema, timeSpecSchema } from './time.ts';

const ids = z.array(id);
const texts = z.array(z.string());
const evidenceRefs = z.array(
  revisionRef.refine((r) => r.targetKind === 'evidence', 'Evidence revision 참조가 필요합니다.'),
);
const assets = z.array(assetRef);
export const sectionSchema = z.strictObject({
  key: id,
  title: text,
  order: uint,
  bodyMd: z.string(),
  factRefs: ids,
  assetRefs: assets,
  linkRefs: z.array(contentRef),
});
const guideCommon = {
  ownerRef: targetRef,
  title: text,
  language: text.optional(),
  sections: z.array(sectionSchema),
  factBindings: z.array(z.strictObject({ token: text, ref: revisionRef.refine((r) => r.targetKind === 'fact') })),
  assetRefs: assets,
};
const guidePayload = z.discriminatedUnion('documentKind', [
  z.strictObject({ documentKind: z.literal('place-guide'), ...guideCommon }),
  z.strictObject({ documentKind: z.literal('region-guide'), ...guideCommon }),
  z.strictObject({ documentKind: z.literal('preparation'), ...guideCommon }),
  z.strictObject({
    documentKind: z.literal('region-essentials'),
    ...guideCommon,
    structuredData: z.strictObject({
      staySummary: z.string(),
      lifeEssentials: texts,
      arrivalStrategy: z.string(),
      departureStrategy: z.string(),
      lateReturnRule: z.string(),
      evidenceRefs,
    }),
  }),
  z.strictObject({
    documentKind: z.literal('transit'),
    ...guideCommon,
    structuredData: z.strictObject({
      recommendation: z.string(),
      products: z.array(
        z.strictObject({
          id,
          title: text,
          priceText: z.string(),
          sharingText: z.string(),
          accessConditions: texts,
          suitability: z.string(),
        }),
      ),
      howToUse: texts,
      exceptions: texts,
      itineraryUses: z.array(z.strictObject({ planVersionId: id, dayIds: ids, description: z.string() })),
      evidenceRefs,
    }),
  }),
  z.strictObject({
    documentKind: z.literal('language-guide'),
    ...guideCommon,
    structuredData: z.strictObject({
      pronunciationRules: z.array(
        z.strictObject({ pattern: text, sound: z.string(), example: z.string(), note: z.string() }),
      ),
      signsAndMenu: z.array(z.strictObject({ text, translation: z.string(), pronunciation: z.string() })),
    }),
  }),
]);
const common = {
  tripId: id,
  entityId: id,
  revisionId: id,
  previousRevisionId: id.optional(),
  schemaVersion: z.literal(2),
  sourceRefs: z.array(sourceRef),
  recordedAt: instant,
  actor: z.enum(['user', 'import', 'ai']),
  commitSeq: positive,
};
export const contentRevisionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...common,
    kind: z.literal('region'),
    payload: z.strictObject({
      name: text,
      nameKo: z.string().optional(),
      countryCode: text.optional(),
      tagline: z.string().optional(),
      introduction: z.string().optional(),
      intensity: z.string().optional(),
      budgetText: z.string().optional(),
      rainPlan: z.string().optional(),
      guideIds: ids,
      assetRefs: assets,
    }),
  }),
  z.strictObject({
    ...common,
    kind: z.literal('place'),
    payload: z.strictObject({
      regionIds: ids,
      name: text,
      aliases: texts,
      placeKind: text,
      foodKind: text.optional(),
      mealRole: text.optional(),
      grade: z.string().optional(),
      gradeLabel: z.string().optional(),
      summary: z.string(),
      dontMiss: texts,
      guideId: id.optional(),
      mapTargetId: id.optional(),
      wikiRef: webUrl.optional(),
      assetRefs: assets,
    }),
  }),
  z.strictObject({ ...common, kind: z.literal('guide'), payload: guidePayload }),
  z.strictObject({
    ...common,
    kind: z.literal('fact'),
    payload: z.strictObject({
      targetRef,
      key: text,
      valueText: z.string(),
      normalizedValue: z.union([z.string(), z.number().finite(), z.boolean(), z.null()]).optional(),
      sourceConfidence: text,
      verifiedAt: timeSpecSchema.optional(),
      recheckBy: date.optional(),
      appliesFrom: date.optional(),
      appliesTo: date.optional(),
      blockedReason: z.string().optional(),
      evidenceRefs,
      appReviewStatus: z.enum(['unverified', 'verified', 'needs-review']),
    }),
  }),
  z.strictObject({
    ...common,
    kind: z.literal('evidence'),
    payload: z
      .strictObject({
        label: z.string().optional(),
        sourceType: z.enum(['web', 'local', 'code', 'xlsx']),
        sourceUrlOrRef: text,
        claim: z.string().optional(),
        sourceVerifiedAt: timeSpecSchema.optional(),
        collectedAt: instant.optional(),
        recheckBy: date.optional(),
        relatedRefs: z.array(targetRef),
      })
      .superRefine((p, ctx) => {
        if (p.sourceType === 'web' && !webUrl.safeParse(p.sourceUrlOrRef).success)
          ctx.addIssue({ code: 'custom', path: ['sourceUrlOrRef'], message: 'HTTP(S) 근거 URL이 필요합니다.' });
      }),
  }),
  z.strictObject({
    ...common,
    kind: z.literal('asset'),
    payload: z.strictObject({
      hash: sha256,
      mimeType: text,
      byteLength: uint,
      title: text,
      assetKind: z.enum(['image', 'pdf', 'map', 'daily-card', 'other']),
      edition: z.string().optional(),
      usage: z.string().optional(),
      publisher: z.string().optional(),
      rightsHolder: z.string().optional(),
      license: z.string().optional(),
      redistributionBasis: z.string().optional(),
      evidenceRefs,
      originalPath: text,
    }),
  }),
  z.strictObject({
    ...common,
    kind: z.literal('booking'),
    payload: z.strictObject({
      type: text,
      title: text,
      regionId: id.optional(),
      placeId: id.optional(),
      activityIds: ids,
      planVersionId: id.optional(),
      time: timeRangeSchema,
      status: text,
      sourceStatusRaw: z.string(),
      stageText: z.string().optional(),
      actionTiming: timeSpecSchema,
      nextActionText: z.string().optional(),
      passNote: z.string().optional(),
      planB: z.string().optional(),
      note: z.string().optional(),
      officialUrl: webUrl.optional(),
      privateDetails: z
        .strictObject({
          confirmationCode: z.string().optional(),
          address: z.string().optional(),
          note: z.string().optional(),
        })
        .optional(),
    }),
  }),
  z.strictObject({
    ...common,
    kind: z.literal('task'),
    payload: z.strictObject({
      targetRef,
      actionType: text,
      label: text,
      detail: z.string(),
      meaningFingerprint: sha256,
    }),
  }),
  z.strictObject({
    ...common,
    kind: z.literal('phrase-book'),
    payload: z.strictObject({
      locale: text,
      note: z.string().optional(),
      categories: ids,
      phrases: z.array(
        z.strictObject({
          id,
          category: id,
          priority: uint,
          text,
          translation: z.string(),
          pronunciationHint: z.string(),
          usageNote: z.string(),
          tags: texts,
          audioText: z.string().optional(),
          aliases: texts,
          placeTypes: texts,
          dayIds: ids,
          planVersionId: id.optional(),
        }),
      ),
      contextRecommendations: z.array(
        z.strictObject({
          placeType: text.optional(),
          planVersionId: id.optional(),
          dayIds: ids,
          phraseIds: ids,
          order: uint.optional(),
        }),
      ),
    }),
  }),
  z.strictObject({
    ...common,
    kind: z.literal('map-target'),
    payload: z.discriminatedUnion('mapKind', [
      z.strictObject({
        mapKind: z.literal('place'),
        label: text,
        query: text,
        lat: z.number().min(-90).max(90).optional(),
        lng: z.number().min(-180).max(180).optional(),
        address: z.string().optional(),
        approximate: z.boolean(),
        private: z.boolean(),
        verificationStatus: text,
        sourceVerdict: z.string().optional(),
        resolvedName: z.string().optional(),
        anchorForText: z.string().optional(),
        evidenceRefs,
      }),
      z.strictObject({
        mapKind: z.literal('route'),
        label: text,
        routeOrigin: text,
        routeDestination: text,
        travelMode: text,
        verificationStatus: text,
        sourceVerdict: z.string().optional(),
        evidenceRefs,
      }),
      z.strictObject({ mapKind: z.literal('none'), label: text, sourceVerdict: z.string(), evidenceRefs }),
    ]),
  }),
]);
export type ContentRevision = z.infer<typeof contentRevisionSchema>;
export const contentHeadSchema = z.strictObject({
  ...contentRef.shape,
  revisionId: id,
  status: z.enum(['active', 'inactive']),
});
