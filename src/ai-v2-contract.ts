import { z } from 'zod';
import { canonicalJson, date, digestBytes, id, sha256, uint, webUrl } from './contracts/v2/index.ts';

/** 서버가 약속하는 실행 한도. 동의 지문에 함께 묶이므로 바뀌면 이전 동의는 무효다. */
export const aiV2Limits = { maxDays: 7, maxSearchCalls: 2, maxPlanningAttempts: 2 } as const;
export const aiV2LocalServer = 'local-node';

const clock = z
  .string()
  .regex(/^\d{2}:\d{2}$/)
  .nullable();
// 비어 있으면 키 자체를 보내지 않는다. null을 보내지 않으려고 clock과 나눠 둔다.
const optionalClock = z
  .string()
  .regex(/^\d{2}:\d{2}$/)
  .optional();
export const aiV2RequestKindSchema = z.enum(['add', 'edit', 'remove']);
export type AiV2RequestKind = z.infer<typeof aiV2RequestKindSchema>;

/** 웹 검색 호출에 가는 값 전부. 자유 요청 원문은 넣지 않는다. */
export const aiV2ResearchDtoSchema = z.strictObject({
  question: z.string().trim().min(1).max(500),
  requestKind: aiV2RequestKindSchema,
  dates: z.array(date).min(1).max(aiV2Limits.maxDays),
  places: z.array(z.strictObject({ name: z.string() })).max(100),
});
export type AiV2ResearchDto = z.infer<typeof aiV2ResearchDtoSchema>;

/** 변경안 작성 호출에 가는 값 전부. 저장 모델을 펼치지 않고 필드를 하나씩 허용한다. */
export const aiV2PlanningDtoSchema = z.strictObject({
  request: z.string().trim().min(1).max(4000),
  requestKind: aiV2RequestKindSchema,
  fromDate: date,
  trip: z.strictObject({ startDate: date, endDate: date }),
  days: z
    .array(
      z.strictObject({
        dayId: id,
        date,
        cityText: z.string(),
        title: z.string(),
        arrival: optionalClock,
        departure: optionalClock,
        // 낮에 끼어 도착·출발로 표현할 수 없는 장거리 이동 구간. 이 안에는 제안할 수 없다.
        blocked: z
          .array(z.strictObject({ from: z.string(), to: z.string() }))
          .max(10)
          .optional(),
      }),
    )
    .min(1)
    .max(aiV2Limits.maxDays),
  items: z
    .array(
      z.strictObject({
        activityId: id,
        dayId: id,
        order: uint,
        title: z.string(),
        category: z.string(),
        summary: z.string(),
        start: clock,
        end: clock,
        fixed: z.boolean(),
        placeId: id.nullable(),
      }),
    )
    .max(300),
  legs: z
    .array(
      z.strictObject({
        dayId: id,
        fromActivityId: id,
        toActivityId: id,
        mode: z.string(),
        durationText: z.string().nullable(),
      }),
    )
    .max(300),
  places: z.array(z.strictObject({ id, name: z.string(), summary: z.string() })).max(300),
  // 선택 범위 바로 다음 날의 시각만. 자정을 넘는 제안의 겹침 판단에 쓴다.
  followingDay: z.strictObject({ date, firstStart: z.string().optional(), arrival: z.string().optional() }).optional(),
  records: z
    .array(
      z.strictObject({
        id,
        kind: z.enum(['actual', 'note', 'legacy-state']),
        date: date.nullable(),
        summary: z.string(),
      }),
    )
    .max(200),
});
export type AiV2PlanningDto = z.infer<typeof aiV2PlanningDtoSchema>;

/** OpenAI로 가지 않고 서버 작업 식별에만 쓰는 봉투. */
export const aiV2ScopeSchema = z.strictObject({
  tripId: id,
  baseDomainRevision: uint,
  basePlanVersionId: id,
});
export type AiV2Scope = z.infer<typeof aiV2ScopeSchema>;

export const aiV2PolicySchema = z.strictObject({
  server: z.string().min(1),
  model: z.string().min(1),
  limits: z.strictObject({ maxDays: uint, maxSearchCalls: uint, maxPlanningAttempts: uint }),
});
export type AiV2Policy = z.infer<typeof aiV2PolicySchema>;

export const aiV2RequestSchema = z.strictObject({
  id: z.uuid(),
  scope: aiV2ScopeSchema,
  research: aiV2ResearchDtoSchema,
  planning: aiV2PlanningDtoSchema,
  consent: aiV2PolicySchema.extend({ fingerprint: sha256 }),
});
export type AiV2Request = z.infer<typeof aiV2RequestSchema>;
export type AiV2Payload = Omit<AiV2Request, 'consent'>;

/** 전송 내용·서버·모델·한도를 묶은 동의 지문. 하나라도 바뀌면 값이 달라진다. */
export async function consentFingerprint(payload: Omit<AiV2Payload, 'id'>, policy: AiV2Policy) {
  const { scope, research, planning } = payload;
  const bytes = new TextEncoder().encode(canonicalJson({ scope, research, planning, policy }));
  return digestBytes(bytes);
}

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
        reason: z.string().min(1),
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
    .array(
      z.strictObject({
        url: webUrl,
        claim: z.string().min(1),
        checkedAt: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable(),
        operationIndexes: z.array(z.number().int().min(0)),
      }),
    )
    .min(1)
    .max(19),
});
export type AiV2Output = z.infer<typeof aiV2OutputSchema>;

export type AiV2Source = { url: string; title: string };
export type AiV2Usage = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  webSearchCalls: number;
};
/** 서버는 초안 재료까지만 만든다. 전체 활동을 아는 브라우저가 저장할 변경안을 완성한다. */
export type AiV2JobResult = {
  output: AiV2Output;
  sources: AiV2Source[];
  planning: AiV2PlanningDto;
  warnings: string[];
};

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
