import { z } from 'zod';
import { dateSchema, tripSchema, type ProposalInput } from './domain.ts';

export const aiRequestSchema = z.object({
  id: z.string().uuid(), trip: tripSchema, fromDate: dateSchema,
  prompt: z.string().trim().min(1).max(1500),
}).strict();
export type AiRequest = z.infer<typeof aiRequestSchema>;
export const modelPlanSchema = z.object({
  reason: z.string(), reservationImpact: z.string(),
  operations: z.array(z.object({
    type: z.enum(['upsert', 'remove']), activityId: z.string(), title: z.string(),
    start: z.string(), end: z.string(), timeZone: z.string(), note: z.string(), placeId: z.string().nullable(),
  }).strict()).min(1).max(20),
  evidence: z.array(z.object({
    source: z.string(), claim: z.string(), appliesFrom: z.string(), appliesTo: z.string(),
    relatedActivityIds: z.array(z.string()),
  }).strict()).max(20),
}).strict();
export type ModelPlan = z.infer<typeof modelPlanSchema>;
export type AiStatus = 'queued' | 'researching' | 'planning' | 'validating' | 'awaiting-decision' | 'failed' | 'cancelled' | 'interrupted';
export type AiJob = {
  id: string; tripId: string; baseRevision: number; status: AiStatus;
  createdAt: string; updatedAt: string; attempt: number; model: string;
  error?: string; proposal?: ProposalInput; sources: { url: string; title: string }[];
};
