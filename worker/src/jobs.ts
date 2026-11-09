// Worker 작업 상태 기계. HTTP 요청은 저장만 하고, 외부 호출은 alarm(tick)에서 background 생성·폴링으로 한다.
import {
  aiV2JobLimits,
  aiV2Limits,
  aiV2RunningStatuses,
  aiV2WorkerServer,
  type AiV2Policy,
  type AiV2Request,
  type AiV2ServerStatus,
  type AiV2Status,
  type AiV2Usage,
} from '../../src/ai-v2-contract.ts';
import {
  addUsage,
  AiV2RequestError,
  checkAiV2Request,
  emptyUsage,
  failureText,
  planningExhaustedMessage,
  repairInstruction,
  toStoredJob,
  type AiV2Job,
} from '../../src/ai-v2-jobs-core.ts';
import {
  assertCompleted,
  planningRequestBody,
  readPlan,
  readResearch,
  researchRequestBody,
  usageOf,
  type AiV2Research,
  type ResponseData,
} from '../../src/ai-v2-openai.ts';
import { toValidationScope, validateAiV2Output } from '../../src/ai-v2-semantics.ts';
import { OpenAiHttpError, OpenAiNetworkError, type OpenAiBackground } from './openai.ts';
import type { AiStore, StoredJobRow } from './store.ts';

/**
 * 실행 중에만 DO 메모리에 두는 요청 원문·조사 본문. 저장소에는 쓰지 않는다(T-D1 허용 목록).
 * DO가 내려가면 사라지므로 그 작업은 interrupted로 끝난다.
 */
export type JobMemory = { input: AiV2Request; research?: AiV2Research; repair: string };

export type WorkerJobsDeps = {
  store: AiStore;
  openai: OpenAiBackground;
  memory: Map<string, JobMemory>;
  now: () => number;
  schedule: (at: number) => void | Promise<void>;
};

export const unknownMessage =
  'OpenAI 호출 중 연결이 끊겨 결과를 알 수 없습니다. 자동으로 다시 부르지 않았습니다. 필요하면 다시 요청하세요.';
export const interruptedMessage = 'Worker가 다시 시작되어 진행 중인 요청 내용을 잃었습니다. 새 요청을 만드세요.';
export const timeoutMessage = '작업 시간 제한을 넘어 중단했습니다. 날짜 범위를 줄여 다시 요청하세요.';
export const lostResponseMessage = 'OpenAI 보관 기간이 지나 결과를 회수하지 못했습니다. 다시 요청하세요.';

const running = new Set<AiV2Status>(aiV2RunningStatuses);
const polling = new Set<AiV2Status>(['researching', 'planning', 'validating']);
const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: aiV2JobLimits.dailyTimeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 일일 한도의 날짜. 사용자 시간대(Asia/Seoul) 기준 YYYY-MM-DD. */
export function limitDay(at: number) {
  return dayFormat.format(new Date(at));
}

export class WorkerJobs {
  private deps: WorkerJobsDeps;
  constructor(deps: WorkerJobsDeps) {
    this.deps = deps;
  }
  private get store() {
    return this.deps.store;
  }
  private iso() {
    return new Date(this.deps.now()).toISOString();
  }

  policy(): AiV2Policy {
    return { server: aiV2WorkerServer, model: this.deps.openai.model, limits: { ...aiV2Limits } };
  }

  status(): AiV2ServerStatus {
    const today = this.store.daily(limitDay(this.deps.now()));
    return {
      configured: this.deps.openai.configured,
      model: this.deps.openai.model,
      policy: this.policy(),
      dailyJobLimit: aiV2JobLimits.dailyJobs,
      remainingToday: Math.max(0, aiV2JobLimits.dailyJobs - today.jobs),
      usageToday: today,
    };
  }

  async create(raw: unknown): Promise<AiV2Job> {
    if (!this.deps.openai.configured) {
      throw new AiV2RequestError(503, 'not_configured', 'Worker의 OpenAI API 키가 설정되지 않았습니다.');
    }
    const { input, fingerprint } = await checkAiV2Request(raw, this.policy());
    this.expire();
    const previous = this.store.getJob(input.id);
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        throw new AiV2RequestError(409, 'duplicate_mismatch', '같은 요청 ID의 내용이 다릅니다.');
      }
      return previous.job;
    }
    const active = this.store.listJobs(aiV2RunningStatuses);
    if (active.length >= aiV2JobLimits.maxRunningJobs || active.some((row) => row.job.tripId === input.scope.tripId)) {
      throw new AiV2RequestError(409, 'job_running', '이미 실행 중인 AI 작업이 있습니다.');
    }
    const day = limitDay(this.deps.now());
    if (this.store.daily(day).jobs >= aiV2JobLimits.dailyJobs) {
      throw new AiV2RequestError(
        429,
        'daily_limit',
        `오늘 AI 요청 한도(${aiV2JobLimits.dailyJobs}회)를 모두 썼습니다. 내일(한국 시간) 다시 요청하세요.`,
      );
    }
    this.prune(aiV2JobLimits.maxStoredJobs - 1);
    if (this.store.countJobs() >= aiV2JobLimits.maxStoredJobs) {
      throw new AiV2RequestError(429, 'storage_limit', 'AI 작업 보관 한도에 도달했습니다.');
    }
    const job: AiV2Job = {
      id: input.id,
      tripId: input.scope.tripId,
      baseDomainRevision: input.scope.baseDomainRevision,
      basePlanVersionId: input.scope.basePlanVersionId,
      status: 'queued',
      createdAt: this.iso(),
      updatedAt: this.iso(),
      model: this.deps.openai.model,
      attempt: 0,
      sources: [],
      usage: emptyUsage,
    };
    this.store.putJob(job, fingerprint, null);
    this.store.addDaily(day, 1, 0);
    this.deps.memory.set(job.id, { input, repair: '' });
    await this.deps.schedule(this.deps.now());
    return toStoredJob(job);
  }

  get(id: string) {
    this.expire();
    return this.store.getJob(id)?.job;
  }

  async cancel(id: string) {
    const row = this.store.getJob(id);
    if (!row) {
      throw new AiV2RequestError(404, 'not_found', 'AI 작업이 없습니다.');
    }
    if (!running.has(row.job.status)) {
      return row.job;
    }
    const job = { ...row.job, status: 'cancelled' as const, updatedAt: this.iso() };
    // 응답 ID는 남겨 두고 다음 alarm이 OpenAI 쪽 취소를 보낸다. 요청 처리 중에는 외부 호출을 하지 않는다.
    this.store.putJob(job, row.fingerprint, row.responseId);
    this.deps.memory.delete(id);
    await this.deps.schedule(this.deps.now());
    return toStoredJob(job);
  }

  /** alarm 한 번. 실행 중 작업을 한 단계씩 진행하고, 남아 있으면 다음 alarm을 잡는다. */
  async tick() {
    this.expire();
    this.prune(aiV2JobLimits.maxStoredJobs);
    for (const row of this.store.listJobs(aiV2RunningStatuses)) {
      await this.advance(row);
    }
    for (const row of this.store.listJobs(['cancelled', 'failed'])) {
      if (row.responseId) {
        await this.deps.openai.cancel(row.responseId).catch(() => undefined);
        this.store.putJob(row.job, row.fingerprint, null);
      }
    }
    if (this.store.listJobs(aiV2RunningStatuses).length) {
      await this.deps.schedule(this.deps.now() + aiV2JobLimits.pollIntervalMs);
    }
  }

  private async advance(row: StoredJobRow) {
    const { job, fingerprint, responseId } = row;
    if (this.deps.now() - Date.parse(job.createdAt) > aiV2JobLimits.jobTimeoutMs) {
      this.finish(job, fingerprint, 'failed', timeoutMessage, responseId);
      return;
    }
    if (job.status === 'calling') {
      // 생성 호출 직전에 쓴 표시가 남아 있다: 호출·과금 여부를 모르므로 다시 부르지 않는다.
      if (!responseId) {
        this.finish(job, fingerprint, 'unknown', unknownMessage, null);
      }
      return;
    }
    const memory = this.deps.memory.get(job.id);
    if (job.status === 'queued') {
      if (!memory) {
        this.finish(job, fingerprint, 'interrupted', interruptedMessage, null);
        return;
      }
      await this.startCall(job, fingerprint, researchRequestBody(memory.input.research));
      return;
    }
    if (polling.has(job.status)) {
      await this.poll(job, fingerprint, responseId, memory);
    }
  }

  /** 상태를 끝내고 메모리를 비운다. 살아 있는 응답 ID는 다음 alarm의 OpenAI 취소용으로 남긴다. */
  private finish(job: AiV2Job, fingerprint: string, status: AiV2Status, error: string, responseId: string | null) {
    job.status = status;
    job.error = error;
    job.updatedAt = this.iso();
    this.store.putJob(job, fingerprint, responseId);
    this.deps.memory.delete(job.id);
  }

  /** 사용량을 작업과 오늘 합계에 함께 더한다. 같은 동기 구간의 쓰기는 DO가 한 번에 확정한다. */
  private chargeUsage(job: AiV2Job, usage: AiV2Usage) {
    job.usage = addUsage(job.usage, usage);
    this.store.addDaily(limitDay(this.deps.now()), 0, usage.totalTokens);
  }

  /** 외부 호출 전에 calling을 먼저 쓴다. 이 쓰기가 실패하면 호출하지 않는다. */
  private async startCall(job: AiV2Job, fingerprint: string, body: Record<string, unknown>) {
    job.status = 'calling';
    job.updatedAt = this.iso();
    this.store.putJob(job, fingerprint, null);
    let created: { id: string };
    try {
      created = await this.deps.openai.create(body);
    } catch (error) {
      if (this.store.getJob(job.id)?.job.status !== 'calling') {
        return;
      }
      if (error instanceof OpenAiNetworkError) {
        this.finish(job, fingerprint, 'unknown', unknownMessage, null);
      } else {
        this.finish(job, fingerprint, 'failed', failureText(error), null);
      }
      return;
    }
    const current = this.store.getJob(job.id);
    if (current && current.job.status !== 'calling') {
      // 호출 중에 사용자가 중단했다. 응답 ID만 붙여 다음 alarm이 OpenAI 쪽도 취소하게 한다.
      this.store.putJob(current.job, current.fingerprint, created.id);
      return;
    }
    job.status = job.attempt === 0 ? 'researching' : 'planning';
    job.updatedAt = this.iso();
    this.store.putJob(job, fingerprint, created.id);
  }

  private async poll(job: AiV2Job, fingerprint: string, responseId: string | null, memory?: JobMemory) {
    if (!responseId) {
      this.finish(job, fingerprint, 'unknown', unknownMessage, null);
      return;
    }
    let data: ResponseData;
    try {
      data = await this.deps.openai.get(responseId);
    } catch (error) {
      if (error instanceof OpenAiNetworkError || (error instanceof OpenAiHttpError && error.status >= 500)) {
        return;
      }
      const message =
        error instanceof OpenAiHttpError && error.status === 404 ? lostResponseMessage : failureText(error);
      this.finish(job, fingerprint, 'failed', message, null);
      return;
    }
    if (this.store.getJob(job.id)?.job.status !== job.status) {
      return;
    }
    if (data.status === 'queued' || data.status === 'in_progress') {
      return;
    }
    if (job.attempt === 0) {
      await this.researchDone(job, fingerprint, data, memory);
      return;
    }
    await this.planningDone(job, fingerprint, responseId, data, memory);
  }

  private async researchDone(job: AiV2Job, fingerprint: string, data: ResponseData, memory?: JobMemory) {
    this.chargeUsage(job, usageOf(data));
    let research: AiV2Research;
    try {
      assertCompleted(data);
      research = readResearch(data);
    } catch (error) {
      this.finish(job, fingerprint, 'failed', failureText(error), null);
      return;
    }
    if (!memory) {
      this.finish(job, fingerprint, 'interrupted', interruptedMessage, null);
      return;
    }
    memory.research = research;
    job.sources = research.sources;
    job.attempt = 1;
    // 사용량·출처·calling이 한 번에 저장된다. 이 쓰기 전에 죽으면 같은 응답을 다시 회수한다.
    await this.startCall(job, fingerprint, planningRequestBody(memory.input.planning, research, memory.repair));
  }

  private async planningDone(
    job: AiV2Job,
    fingerprint: string,
    responseId: string,
    data: ResponseData,
    memory?: JobMemory,
  ) {
    if (job.status === 'planning') {
      // 응답 수신 → 사용량과 함께 먼저 저장 → 그다음 검사·전이. 이후 실패해도 같은 응답 ID로 다시 회수한다.
      this.chargeUsage(job, usageOf(data));
      job.status = 'validating';
      job.updatedAt = this.iso();
      this.store.putJob(job, fingerprint, responseId);
    }
    let output;
    try {
      assertCompleted(data);
      output = readPlan(data);
    } catch (error) {
      this.finish(job, fingerprint, 'failed', failureText(error), null);
      return;
    }
    if (!memory?.research) {
      this.finish(job, fingerprint, 'interrupted', interruptedMessage, null);
      return;
    }
    let warnings: string[];
    try {
      warnings = validateAiV2Output(memory.input.planning, output, memory.research.sources);
    } catch (validation) {
      if (job.attempt >= aiV2Limits.maxPlanningAttempts) {
        this.finish(job, fingerprint, 'failed', planningExhaustedMessage, null);
        return;
      }
      memory.repair = repairInstruction(validation instanceof Error ? validation.message : 'invalid output');
      job.attempt += 1;
      await this.startCall(
        job,
        fingerprint,
        planningRequestBody(memory.input.planning, memory.research, memory.repair),
      );
      return;
    }
    job.result = {
      output,
      sources: memory.research.sources,
      scope: toValidationScope(memory.input.planning),
      warnings,
    };
    job.status = 'awaiting-decision';
    job.updatedAt = this.iso();
    this.store.putJob(job, fingerprint, null);
    this.deps.memory.delete(job.id);
  }

  /** 끝난 지 보존 기한이 지난 작업은 출력(result·error)을 지우고 expired로 둔다. 조회·쓰기·alarm 때 부른다. */
  private expire() {
    const cutoff = new Date(this.deps.now() - aiV2JobLimits.outputRetentionMs).toISOString();
    for (const row of this.store.listExpirable(aiV2RunningStatuses, cutoff)) {
      const expired: AiV2Job = { ...row.job, status: 'expired', updatedAt: this.iso() };
      delete expired.result;
      delete expired.error;
      this.store.putJob(expired, row.fingerprint, row.responseId);
    }
  }

  /** 보관 건수를 limit 이하로 줄인다. 만료 작업 중 오래된 것부터, 그다음 끝난 작업 중 오래된 것부터 지운다. */
  private prune(limit: number) {
    let total = this.store.countJobs();
    if (total <= limit) {
      return;
    }
    const finished = this.store.listJobs().filter((row) => !running.has(row.job.status));
    const ordered = [
      ...finished.filter((row) => row.job.status === 'expired'),
      ...finished.filter((row) => row.job.status !== 'expired'),
    ];
    for (const row of ordered) {
      if (total <= limit) {
        return;
      }
      this.store.deleteJob(row.job.id);
      total -= 1;
    }
  }
}
