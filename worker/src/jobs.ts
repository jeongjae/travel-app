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
  aiV2JobListLimit,
  AiV2RequestError,
  checkAiV2Request,
  emptyUsage,
  failureText,
  planningExhaustedMessage,
  repairInstruction,
  toJobSummary,
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
 * 실행 중 작업의 요청 원문·조사 본문. 메모리에 두고 `inflight` 표에도 같이 쓴다(U-D2-1).
 * DO가 다시 뜨면 `inflight`에서 복원해 이어 간다. 작업이 끝나는 쓰기와 같은 트랜잭션에서 둘 다 지운다.
 */
export type JobMemory = { input: AiV2Request; research?: AiV2Research; repair: string };

/** 작업 행 쓰기에 함께 확정할 것: 이번 응답의 사용량, 갱신된 실행 중 원문. */
type SaveChange = { usage?: AiV2Usage; memory?: JobMemory };

export type WorkerJobsDeps = {
  store: AiStore;
  openai: OpenAiBackground;
  memory: Map<string, JobMemory>;
  now: () => number;
  schedule: (at: number) => void | Promise<void>;
  /** 하루 생성 요청 한도. 환경값(DAILY_LIMIT)에서 오며 없으면 계약 기본값. */
  dailyLimit?: number;
};

export const unknownMessage =
  'OpenAI 호출 중 연결이 끊겨 결과를 알 수 없습니다. 자동으로 다시 부르지 않았습니다. 필요하면 다시 요청하세요.';
export const interruptedMessage = 'Worker가 다시 시작되어 진행 중인 요청 내용을 잃었습니다. 새 요청을 만드세요.';
export const internalErrorMessage = 'Worker 내부 오류로 이 작업을 끝냈습니다. 새 요청을 만드세요.';
export const notAwaitingMessage = '저장 확인을 받을 결과가 없는 작업입니다.';
export const timeoutMessage = '작업 시간 제한을 넘어 중단했습니다. 날짜 범위를 줄여 다시 요청하세요.';
export const lostResponseMessage = 'OpenAI 보관 기간이 지나 결과를 회수하지 못했습니다. 다시 요청하세요.';

const running = new Set<AiV2Status>(aiV2RunningStatuses);
const polling = new Set<AiV2Status>(['researching', 'planning', 'validating']);
/** 보존 기한 만료 대상에서 뺄 상태. 저장 확인(acknowledged)은 이미 출력을 지웠다. */
const notExpirable: readonly AiV2Status[] = [...aiV2RunningStatuses, 'acknowledged'];
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

  private dailyLimit() {
    return this.deps.dailyLimit ?? aiV2JobLimits.dailyJobs;
  }

  status(): AiV2ServerStatus {
    const today = this.store.daily(limitDay(this.deps.now()));
    return {
      configured: this.deps.openai.configured,
      model: this.deps.openai.model,
      policy: this.policy(),
      dailyJobLimit: this.dailyLimit(),
      remainingToday: Math.max(0, this.dailyLimit() - today.jobs),
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
      // 202 응답을 못 받은 브라우저의 재전송(B1). 같은 작업을 돌려주고 일일 횟수는 더 쓰지 않는다.
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
    if (this.store.daily(day).jobs >= this.dailyLimit()) {
      throw new AiV2RequestError(
        429,
        'daily_limit',
        `오늘 AI 요청 한도(${this.dailyLimit()}회)를 모두 썼습니다. 내일(한국 시간) 다시 요청하세요.`,
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
    const memory: JobMemory = { input, repair: '' };
    // 작업 행·일일 횟수·실행 중 원문을 한 번에 확정한다.
    this.store.atomic(() => {
      this.store.putJob(job, fingerprint, null);
      this.store.addDaily(day, 1, 0);
      this.store.putInflight(job.id, inflightRow(memory));
    });
    this.deps.memory.set(job.id, memory);
    await this.deps.schedule(this.deps.now());
    return toStoredJob(job);
  }

  /**
   * 한 여행의 최근 작업 기록(CL-38). 상태·시각·사용량만 내보내고 결과·출처·오류 문구는 뺀다.
   * 화면 "AI 작업 기록"이 쓰며 내용은 보이지 않는다.
   */
  list(tripId: string | null) {
    if (!tripId || !/^[A-Za-z0-9_-]{1,128}$/.test(tripId)) {
      throw new AiV2RequestError(400, 'invalid_request', '여행 ID가 필요합니다.');
    }
    this.expire();
    const jobs = this.store.listTripJobs(tripId, aiV2JobListLimit).map(({ job }) => toJobSummary(job));
    return { jobs };
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
    const job: AiV2Job = { ...row.job, status: 'cancelled' };
    // 응답 ID는 남겨 두고 다음 alarm이 OpenAI 쪽 취소를 보낸다. 요청 처리 중에는 외부 호출을 하지 않는다.
    this.save(job, row.fingerprint, row.responseId);
    await this.deps.schedule(this.deps.now());
    return toStoredJob(job);
  }

  /**
   * 저장 확인(B4). 브라우저가 변경안 저장에 성공한 직후 부른다. 출력(result)을 지우고 acknowledged로 둔다.
   * 사용량·출처 같은 비내용 필드는 남긴다. ACK가 유실되면 24시간 보존 기한이 지운다.
   */
  acknowledge(id: string) {
    this.expire();
    const row = this.store.getJob(id);
    if (!row) {
      throw new AiV2RequestError(404, 'not_found', 'AI 작업이 없습니다.');
    }
    if (row.job.status === 'acknowledged') {
      return row.job;
    }
    if (row.job.status !== 'awaiting-decision') {
      throw new AiV2RequestError(409, 'not_awaiting_decision', notAwaitingMessage);
    }
    const job: AiV2Job = { ...row.job, status: 'acknowledged' };
    delete job.result;
    this.save(job, row.fingerprint, row.responseId);
    return toStoredJob(job);
  }

  /**
   * alarm 한 번. 실행 중 작업을 한 단계씩 진행하고, 남아 있으면 다음 alarm을 잡는다.
   * 한 작업의 예외가 다른 작업과 재예약을 막지 않도록 작업마다 가두고, 재예약은 finally에서 한다.
   */
  async tick() {
    try {
      this.expire();
      this.prune(aiV2JobLimits.maxStoredJobs);
      for (const row of this.store.listJobs(aiV2RunningStatuses)) {
        try {
          await this.advance(row);
        } catch {
          this.contain(row.job.id);
        }
      }
      for (const row of this.store.listJobs(['cancelled', 'failed'])) {
        if (row.responseId) {
          await this.deps.openai.cancel(row.responseId).catch(() => undefined);
          this.store.putJob(row.job, row.fingerprint, null);
        }
      }
    } finally {
      if (this.store.listJobs(aiV2RunningStatuses).length) {
        await this.deps.schedule(this.deps.now() + aiV2JobLimits.pollIntervalMs);
      }
    }
  }

  /**
   * 한 작업에서 난 예상 밖 예외의 처리. 예외 문구는 입력을 담을 수 있으므로 저장하지 않는다.
   * - 응답을 받아 사용량까지 저장한 validating: 같은 응답 ID로 다시 회수한다(외부 생성 없음, 작업 시간 상한이 끝을 정한다).
   * - calling(응답 ID 없음): 생성 호출이 나갔는지 모르므로 unknown.
   * - 그 밖: failed(내부 오류).
   */
  private contain(id: string) {
    const row = this.store.getJob(id);
    if (!row || !running.has(row.job.status)) {
      return;
    }
    if (row.job.status === 'validating' && row.responseId) {
      return;
    }
    if (row.job.status === 'calling' && !row.responseId) {
      this.finish(row.job, row.fingerprint, 'unknown', unknownMessage, null);
      return;
    }
    this.finish(row.job, row.fingerprint, 'failed', internalErrorMessage, row.responseId);
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
    const memory = this.recall(job.id);
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

  /** 메모리에 없으면 `inflight`에서 복원한다(DO 재시작). 둘 다 없으면 이전 형식 작업이다. */
  private recall(id: string): JobMemory | undefined {
    const cached = this.deps.memory.get(id);
    if (cached) {
      return cached;
    }
    const row = this.store.getInflight(id);
    if (!row) {
      return undefined;
    }
    const memory: JobMemory = { input: JSON.parse(row.input) as AiV2Request, repair: row.repair };
    if (row.research) {
      memory.research = JSON.parse(row.research) as AiV2Research;
    }
    this.deps.memory.set(id, memory);
    return memory;
  }

  /**
   * 작업 행 쓰기의 유일한 경로. 사용량·일일 합계·실행 중 원문을 같은 트랜잭션으로 확정한다(안에서 await 없음).
   * 끝난 상태로 쓰면 같은 트랜잭션에서 `inflight` 행을 지운다.
   */
  private save(job: AiV2Job, fingerprint: string, responseId: string | null, change: SaveChange = {}) {
    const { usage, memory } = change;
    const finished = !running.has(job.status);
    job.updatedAt = this.iso();
    if (usage) {
      job.usage = addUsage(job.usage, usage);
    }
    this.store.atomic(() => {
      if (usage) {
        this.store.addDaily(limitDay(this.deps.now()), 0, usage.totalTokens);
      }
      this.store.putJob(job, fingerprint, responseId);
      if (finished) {
        this.store.deleteInflight(job.id);
      } else if (memory) {
        this.store.putInflight(job.id, inflightRow(memory));
      }
    });
    if (finished) {
      this.deps.memory.delete(job.id);
    } else if (memory) {
      this.deps.memory.set(job.id, memory);
    }
  }

  /** 상태를 끝낸다. 살아 있는 응답 ID는 다음 alarm의 OpenAI 취소용으로 남긴다. */
  private finish(
    job: AiV2Job,
    fingerprint: string,
    status: AiV2Status,
    error: string,
    responseId: string | null,
    usage?: AiV2Usage,
  ) {
    job.status = status;
    job.error = error;
    this.save(job, fingerprint, responseId, { usage });
  }

  /** 외부 호출 전에 calling을 먼저 쓴다(직전 응답의 사용량·원문 갱신과 함께). 이 쓰기가 실패하면 호출하지 않는다. */
  private async startCall(job: AiV2Job, fingerprint: string, body: Record<string, unknown>, change: SaveChange = {}) {
    job.status = 'calling';
    this.save(job, fingerprint, null, change);
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
    this.save(job, fingerprint, created.id);
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
      // 연결 실패·5xx는 다음 alarm에 다시 묻는다. 작업 시간 상한(15분)이 끝을 정한다(B8).
      if (error instanceof OpenAiNetworkError || (error instanceof OpenAiHttpError && error.status >= 500)) {
        return;
      }
      const message =
        error instanceof OpenAiHttpError && error.status === 404 ? lostResponseMessage : failureText(error);
      this.finish(job, fingerprint, 'failed', message, null);
      return;
    }
    // await 사이에 다른 alarm·중단이 이 작업을 바꿨으면 손대지 않는다. 같은 응답의 사용량을 두 번 더하지 않는 근거다.
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
    const usage = usageOf(data);
    let research: AiV2Research;
    try {
      assertCompleted(data);
      research = readResearch(data);
    } catch (error) {
      this.finish(job, fingerprint, 'failed', failureText(error), null, usage);
      return;
    }
    if (!memory) {
      this.finish(job, fingerprint, 'interrupted', interruptedMessage, null, usage);
      return;
    }
    const next: JobMemory = { ...memory, research };
    job.sources = research.sources;
    job.attempt = 1;
    // 사용량·출처·조사 본문·calling이 한 트랜잭션으로 저장된다. 이 쓰기 전에 죽으면 같은 응답을 다시 회수한다.
    await this.startCall(job, fingerprint, planningRequestBody(next.input.planning, research, next.repair), {
      usage,
      memory: next,
    });
  }

  private async planningDone(
    job: AiV2Job,
    fingerprint: string,
    responseId: string,
    data: ResponseData,
    memory?: JobMemory,
  ) {
    if (job.status === 'planning') {
      // 응답 수신 → 사용량과 함께 validating을 먼저 저장 → 그다음 검사·전이. 이후 실패해도 같은 응답 ID로 다시 회수한다.
      job.status = 'validating';
      this.save(job, fingerprint, responseId, { usage: usageOf(data) });
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
      const next: JobMemory = {
        ...memory,
        repair: repairInstruction(validation instanceof Error ? validation.message : 'invalid output'),
      };
      job.attempt += 1;
      await this.startCall(job, fingerprint, planningRequestBody(next.input.planning, memory.research, next.repair), {
        memory: next,
      });
      return;
    }
    job.result = {
      output,
      sources: memory.research.sources,
      scope: toValidationScope(memory.input.planning),
      warnings,
    };
    job.status = 'awaiting-decision';
    this.save(job, fingerprint, null);
  }

  /** 끝난 지 보존 기한이 지난 작업은 출력(result·error)을 지우고 expired로 둔다. 조회·쓰기·alarm 때 부른다. */
  private expire() {
    const cutoff = new Date(this.deps.now() - aiV2JobLimits.outputRetentionMs).toISOString();
    for (const row of this.store.listExpirable(notExpirable, cutoff)) {
      const expired: AiV2Job = { ...row.job, status: 'expired' };
      delete expired.result;
      delete expired.error;
      this.save(expired, row.fingerprint, row.responseId);
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
      // 작업 행과 남은 inflight 행을 함께 지운다.
      this.store.atomic(() => this.store.deleteJob(row.job.id));
      total -= 1;
    }
  }
}

function inflightRow(memory: JobMemory) {
  return {
    input: JSON.stringify(memory.input),
    research: memory.research ? JSON.stringify(memory.research) : null,
    repair: memory.repair,
  };
}
