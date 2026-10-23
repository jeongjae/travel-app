import { z } from 'zod';
import { date, id, planVersionSchema, tripHeaderSchema, uint, webUrl } from './contracts/v2/index.ts';

export const aiV2RequestSchema = z.strictObject({
  id: z.uuid(),
  prompt: z.string().trim().min(1).max(4000),
  fromDate: date,
  consent: z.literal(true),
  context: z.strictObject({
    header: tripHeaderSchema,
    plan: planVersionSchema,
    places: z.array(z.strictObject({ id, name: z.string(), summary: z.string() })).max(1000),
    records: z
      .array(
        z.strictObject({
          id,
          kind: z.string(),
          recordedAt: z.string(),
          summary: z.string(),
        }),
      )
      .max(1000),
  }),
});
export type AiV2Request = z.infer<typeof aiV2RequestSchema>;
export const aiV2OutputSchema = z.strictObject({
  reason: z.string().min(1),
  reservationImpact: z.string().min(1),
  operations: z
    .array(
      z.strictObject({
        type: z.enum(['edit', 'add', 'remove']),
        activityId: z.string(),
        dayId: z.string(),
        title: z.string(),
        summary: z.string(),
        startTime: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .nullable(),
        endTime: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .nullable(),
        placeId: z.string().nullable(),
      }),
    )
    .min(1)
    .max(30),
  evidence: z
    .array(z.strictObject({ url: webUrl, claim: z.string().min(1) }))
    .min(1)
    .max(20),
});
export type AiV2Output = z.infer<typeof aiV2OutputSchema>;
export const aiV2StatusSchema = z.enum([
  'queued',
  'researching',
  'planning',
  'validating',
  'awaiting-decision',
  'failed',
  'cancelled',
  'interrupted',
]);
export type AiV2Status = z.infer<typeof aiV2StatusSchema>;
export const aiV2JobIdentitySchema = z.strictObject({
  id: z.uuid(),
  tripId: id,
  baseDomainRevision: uint,
  basePlanVersionId: id,
});
