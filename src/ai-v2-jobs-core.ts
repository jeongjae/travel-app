// Node 서버와 Worker가 같이 쓰는 v2 작업 규칙. 허용 목록·동의 지문·요청 지문을 한 곳에서 정한다.
import { canonicalJson, digestBytes } from './contracts/v2/index.ts';
import {
  aiV2RequestSchema,
  consentFingerprint,
  type AiV2JobResult,
  type AiV2PlanningDto,
  type AiV2Policy,
  type AiV2Request,
  type AiV2Status,
  type AiV2Usage,
} from './ai-v2-contract.ts';
import { toValidationScope } from './ai-v2-semantics.ts';

export type AiV2Job = {
  id: string;
  tripId: string;
  baseDomainRevision: number;
  basePlanVersionId: string;
  status: AiV2Status;
  createdAt: string;
  updatedAt: string;
  model: string;
  attempt: number;
  sources: { url: string; title: string }[];
  usage: AiV2Usage;
  result?: AiV2JobResult;
  error?: string;
};

export const emptyUsage: AiV2Usage = { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, webSearchCalls: 0 };

export function addUsage(total: AiV2Usage, usage: AiV2Usage): AiV2Usage {
  return {
    calls: total.calls + usage.calls,
    inputTokens: total.inputTokens + usage.inputTokens,
    outputTokens: total.outputTokens + usage.outputTokens,
    totalTokens: total.totalTokens + usage.totalTokens,
    webSearchCalls: total.webSearchCalls + usage.webSearchCalls,
    toolCallItems: (total.toolCallItems ?? 0) + (usage.toolCallItems ?? 0),
    webSearchQueries: (total.webSearchQueries ?? 0) + (usage.webSearchQueries ?? 0),
  };
}

/** 작업 기록 목록(CL-38)에 남기는 필드. 결과·출처·오류 문구는 빼고 출처는 개수만 둔다. */
export type AiV2JobSummary = Pick<
  AiV2Job,
  'id' | 'tripId' | 'status' | 'createdAt' | 'updatedAt' | 'model' | 'attempt' | 'usage'
> & { sourceCount: number };
export const aiV2JobListLimit = 50;

export function toJobSummary(raw: AiV2Job): AiV2JobSummary {
  const job = toStoredJob(raw);
  return {
    id: job.id,
    tripId: job.tripId,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    model: job.model,
    attempt: job.attempt,
    usage: job.usage,
    sourceCount: job.sources.length,
  };
}

/**
 * 저장·응답에 남길 수 있는 필드의 유일한 목록. 여기 없는 값은 저장 직전과 응답 직전에 제거한다.
 * 이전 형식(`result.planning`)도 재검증 값만 옮기므로 요청 원문·기록이 따라오지 않는다.
 */
export function toStoredJob(raw: AiV2Job): AiV2Job {
  const legacy = raw.result as (AiV2JobResult & { planning?: AiV2PlanningDto }) | undefined;
  const scopeSource = legacy?.scope ?? legacy?.planning;
  return {
    id: raw.id,
    tripId: raw.tripId,
    baseDomainRevision: raw.baseDomainRevision,
    basePlanVersionId: raw.basePlanVersionId,
    status: raw.status,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    model: raw.model,
    attempt: raw.attempt,
    sources: raw.sources,
    usage: raw.usage ?? emptyUsage,
    ...(legacy?.output && scopeSource
      ? {
          result: {
            output: legacy.output,
            sources: legacy.sources,
            scope: toValidationScope(scopeSource),
            warnings: legacy.warnings ?? [],
          },
        }
      : {}),
    ...(raw.error ? { error: raw.error } : {}),
  };
}

/** 요청 본문 검사 실패. 상태 코드와 화면용 문구를 함께 갖는다. */
export class AiV2RequestError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * 스키마·날짜 일치·동의 지문을 검사하고 중복 판정용 요청 지문을 돌려준다.
 * 동의 지문은 전송 내용과 서버·모델·한도를 묶으므로 정책이 바뀌면 이전 동의는 통과하지 못한다.
 */
export async function checkAiV2Request(raw: unknown, policy: AiV2Policy) {
  const input: AiV2Request = aiV2RequestSchema.parse(raw);
  const { planning } = input;
  const dayIds = new Set(planning.days.map((day) => day.dayId));
  if (
    planning.fromDate < planning.trip.startDate ||
    planning.fromDate > planning.trip.endDate ||
    planning.days.some((day) => day.date < planning.fromDate || day.date > planning.trip.endDate) ||
    planning.items.some((item) => !dayIds.has(item.dayId))
  ) {
    throw new AiV2RequestError(
      400,
      'invalid_scope',
      'AI 요청의 여행·계획·선택 날짜가 일치하지 않습니다. 최대 7일을 선택하세요.',
    );
  }
  const { fingerprint: agreed, ...agreedPolicy } = input.consent;
  if (agreed !== (await consentFingerprint(input, policy)) || canonicalJson(agreedPolicy) !== canonicalJson(policy)) {
    throw new AiV2RequestError(
      409,
      'consent_mismatch',
      '동의한 전송 내용·서버·모델·한도가 이 요청과 다릅니다. 미리보기를 다시 확인하세요.',
    );
  }
  const fingerprint = await digestBytes(new TextEncoder().encode(canonicalJson(input)));
  return { input, fingerprint };
}

/** 검증 실패를 다음 작성 호출에 알리는 문구. */
export function repairInstruction(detail: string) {
  return `The proposal failed local date/reference/time/shape checks: ${detail} Recheck known activity/place/day IDs, arrival/departure and fixed time windows, and cited source URLs; preserve untouched fields.`;
}

export const planningExhaustedMessage = '2회 작성 후에도 날짜·참조·변경안 검증을 통과하지 못했습니다.';

/** 화면에 보일 실패 문구. 스키마·JSON 오류는 입력을 담을 수 있으므로 일반 문구로 바꾼다. */
export function failureText(error: unknown) {
  if (error instanceof Error && error.name !== 'ZodError' && error.name !== 'SyntaxError') {
    return error.message;
  }
  return 'AI 응답 형식을 처리하지 못했습니다.';
}
