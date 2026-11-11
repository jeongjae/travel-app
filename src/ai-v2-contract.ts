import { z } from 'zod';
import { canonicalJson, date, digestBytes, id, sha256, uint, webUrl } from './contracts/v2/index.ts';

/** 서버가 약속하는 실행 한도. 동의 지문에 함께 묶이므로 바뀌면 이전 동의는 무효다. */
/** 보존 기한이 지나 출력이 지워진 작업의 `error` 값. 서버가 쓰고 화면이 같은 값으로 "만료"를 알아본다. */
export const outputExpiredMessage = '결과가 만료되어 다시 요청해야 합니다.';
export const aiV2Limits = { maxDays: 7, maxSearchCalls: 2, maxPlanningAttempts: 2 } as const;
export const aiV2LocalServer = 'local-node';
/** Worker 경로가 동의 정책에 싣는 서버 이름. */
export const aiV2WorkerServer = 'cloudflare-worker';

/**
 * 동의 지문 밖의 운영 한도. 바꿔도 이전 동의가 무효가 되지 않으므로 aiV2Limits와 나눠 둔다.
 * 일일 횟수의 날짜는 사용자 시간대(dailyTimeZone) 기준이다.
 */
export const aiV2JobLimits = {
  dailyJobs: 20,
  dailyTimeZone: 'Asia/Seoul',
  maxStoredJobs: 200,
  maxRunningJobs: 2,
  maxBodyBytes: 512 * 1024,
  outputRetentionMs: 24 * 60 * 60 * 1000,
  pollIntervalMs: 2000,
  jobTimeoutMs: 15 * 60 * 1000,
  tokenLifetimeMs: 60 * 60 * 1000,
  challengeLifetimeMs: 5 * 60 * 1000,
} as const;

const clock = z
  .string()
  .regex(/^\d{2}:\d{2}$/)
  .nullable();
// 비어 있으면 키 자체를 보내지 않는다. null을 보내지 않으려고 clock과 나눠 둔다.
const optionalClock = z
  .string()
  .regex(/^\d{2}:\d{2}$/)
  .optional();
const blockedClock = z.string().regex(/^\d{2}:\d{2}$/);
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
          .array(z.strictObject({ from: blockedClock, to: blockedClock }))
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
  /** 응답의 `web_search_call` 출력 항목 수. */
  webSearchCalls: number;
  /**
   * CL-37 대조용(내용 없음). 도구 호출 출력 항목(`*_call`) 전체 수와, 그중 웹 검색 동작이 `search`인 항목 수.
   * T-D5 이전 작업에는 없다.
   */
  toolCallItems?: number;
  webSearchQueries?: number;
};
/** 재검증에 필요한 식별자·시각만. 요청 원문, 기록, 활동 제목·요약은 들어가지 않으므로 저장해도 된다. */
export type AiV2ValidationScope = {
  fromDate: string;
  trip: { startDate: string; endDate: string };
  days: {
    dayId: string;
    date: string;
    arrival?: string;
    departure?: string;
    blocked?: { from: string; to: string }[];
  }[];
  items: { activityId: string; dayId: string; start: string | null; end: string | null; fixed: boolean }[];
  places: { id: string }[];
  followingDay?: { date: string; firstStart?: string; arrival?: string };
};

/** 서버는 초안 재료까지만 만든다. 전체 활동을 아는 브라우저가 저장할 변경안을 완성한다. */
export type AiV2JobResult = {
  output: AiV2Output;
  sources: AiV2Source[];
  scope: AiV2ValidationScope;
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
  // Worker 경로 전용. 외부 호출 직전(calling), 호출 여부 불명(unknown), 보존 기한 경과(expired).
  'calling',
  'unknown',
  'expired',
  // T-D3 저장 확인(ACK): 브라우저가 변경안 저장에 성공해 서버가 출력을 지운 상태.
  'acknowledged',
]);
export type AiV2Status = z.infer<typeof aiV2StatusSchema>;
/** 아직 끝나지 않은 작업 상태. 화면 폴링과 서버의 실행 중 판정이 같은 목록을 쓴다. */
export const aiV2RunningStatuses: readonly AiV2Status[] = [
  'queued',
  'calling',
  'researching',
  'planning',
  'validating',
];

/** 저장 확인 경로. 브라우저가 변경안 저장(Stage)에 성공한 직후 POST한다. 본문은 비어 있다. */
export function aiV2AckPath(jobId: string) {
  return `/api/ai/v2/jobs/${jobId}/ack`;
}

/** 상태 API 응답. Worker는 잔여 횟수·오늘 사용량을 더한다. */
export type AiV2ServerStatus = {
  configured: boolean;
  model?: string;
  policy?: AiV2Policy;
  dailyJobLimit?: number;
  remainingToday?: number;
  usageToday?: { jobs: number; totalTokens: number };
};
export const aiV2JobIdentitySchema = z.strictObject({
  id: z.uuid(),
  tripId: id,
  baseDomainRevision: uint,
  basePlanVersionId: id,
});
