import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  aiV2JobLimits,
  aiV2Limits,
  aiV2LocalServer,
  outputExpiredMessage,
  type AiV2Policy,
  type AiV2Request,
  type AiV2Status,
  type AiV2Usage,
} from '../src/ai-v2-contract.ts';
import {
  addUsage,
  checkAiV2Request,
  emptyUsage,
  failureText,
  isResponseShapeError,
  planningExhaustedMessage,
  repairInstruction,
  shapeErrorCode,
  shapeExhaustedMessage,
  toStoredJob,
  type AiV2Job,
} from '../src/ai-v2-jobs-core.ts';
import { toValidationScope, validateAiV2Output } from '../src/ai-v2-semantics.ts';
import type { AiV2Provider } from './ai-v2.ts';

export { toStoredJob, type AiV2Job } from '../src/ai-v2-jobs-core.ts';

const running = new Set<AiV2Status>(['queued', 'researching', 'planning', 'validating']);
/** 작업이 끝난 뒤 AI 출력을 jobs.json에 남기는 시간. 보존 기한은 이 상수 한 곳에서 정한다. */
export const outputRetentionMs = aiV2JobLimits.outputRetentionMs;
const now = () => new Date().toISOString();
export class AiV2Jobs {
  private jobs = new Map<string, { job: AiV2Job; fingerprint: string }>();
  private controllers = new Map<string, AbortController>();
  private writes: Promise<void> = Promise.resolve();
  provider: AiV2Provider;
  private directory: string;
  constructor(provider: AiV2Provider, directory: string) {
    this.provider = provider;
    this.directory = directory;
  }
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const rows = JSON.parse(await readFile(join(this.directory, 'jobs.json'), 'utf8')) as {
        job: AiV2Job;
        fingerprint: string;
      }[];
      for (const stored of rows) {
        // 다음 persist가 파일을 다시 쓰므로 이전에 저장된 원문·기록은 시작할 때 사라진다.
        const row = { job: toStoredJob(stored.job), fingerprint: stored.fingerprint };
        if (running.has(row.job.status)) {
          row.job.status = 'interrupted';
          row.job.updatedAt = now();
          row.job.error = '서버가 재시작되었습니다. 최신 컨텍스트로 새 요청을 만드세요.';
        }
        this.jobs.set(row.job.id, row);
      }
      this.expireOutputs();
      await this.persist();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error('v2 AI 작업 저장소를 읽지 못했습니다. 원본 파일을 보존했습니다.');
      }
    }
  }
  /**
   * 끝난 지 보존 기한이 지난 작업의 AI 출력(result·error 문구)을 지운다. 시작할 때와 새 작업을 저장할 때만 부른다.
   * 새 필드 없이 error 문자열로 만료를 알리고, 변경안 대기 상태였다면 결과가 없으므로 failed로 바꾼다.
   */
  private expireOutputs(at = Date.now()) {
    for (const { job } of this.jobs.values()) {
      if (running.has(job.status) || (!job.result && !job.error) || job.error === outputExpiredMessage) {
        continue;
      }
      if (at - Date.parse(job.updatedAt) < outputRetentionMs) {
        continue;
      }
      delete job.result;
      job.error = outputExpiredMessage;
      if (job.status === 'awaiting-decision') {
        job.status = 'failed';
      }
    }
  }
  private persist() {
    const data = JSON.stringify(
      [...this.jobs.values()].map(({ job, fingerprint }) => ({ job: toStoredJob(job), fingerprint })),
    );
    const write = this.writes.then(async () => {
      const target = join(this.directory, 'jobs.json');
      await writeFile(target + '.tmp', data, { mode: 0o600 });
      await rename(target + '.tmp', target);
    });
    this.writes = write.catch(() => {});
    return write;
  }
  get(id: string) {
    this.expireOutputs();
    const row = this.jobs.get(id);
    return row ? toStoredJob(row.job) : undefined;
  }
  /** 동의가 묶이는 서버·모델·한도. 상태 API로 화면에 알리고 요청을 받을 때 다시 계산한다. */
  policy(): AiV2Policy {
    return { server: aiV2LocalServer, model: this.provider.model, limits: { ...aiV2Limits } };
  }
  list(tripId: string) {
    return [...this.jobs.values()]
      .map((row) => row.job)
      .filter((job) => job.tripId === tripId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async create(raw: unknown) {
    const { input, fingerprint } = await checkAiV2Request(raw, this.policy());
    const { scope } = input;
    const previous = this.jobs.get(input.id);
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        throw new Error('같은 요청 ID의 내용이 다릅니다.');
      }
      return toStoredJob(previous.job);
    }
    if (this.controllers.size >= 2 || this.list(scope.tripId).some((job) => running.has(job.status))) {
      throw new Error('이미 실행 중인 AI 작업이 있습니다.');
    }
    if (
      this.jobs.size >= 200 ||
      [...this.jobs.values()].filter(({ job }) => job.createdAt.slice(0, 10) === now().slice(0, 10)).length >= 20
    ) {
      throw new Error('AI 작업 보관/일일 실행 한도에 도달했습니다.');
    }
    this.expireOutputs();
    const job: AiV2Job = {
      id: input.id,
      tripId: scope.tripId,
      baseDomainRevision: scope.baseDomainRevision,
      basePlanVersionId: scope.basePlanVersionId,
      status: 'queued',
      createdAt: now(),
      updatedAt: now(),
      model: this.provider.model,
      attempt: 0,
      sources: [],
      usage: emptyUsage,
    };
    const controller = new AbortController();
    this.jobs.set(job.id, { job, fingerprint });
    this.controllers.set(job.id, controller);
    try {
      await this.persist();
    } catch {
      this.jobs.delete(job.id);
      this.controllers.delete(job.id);
      throw new Error('작업을 저장하지 못해 API를 실행하지 않았습니다.');
    }
    void this.execute(input, job, controller).catch(() => {});
    return toStoredJob(job);
  }
  async cancel(id: string) {
    const job = this.jobs.get(id)?.job;
    if (!job) {
      throw new Error('AI 작업이 없습니다.');
    }
    if (running.has(job.status)) {
      job.status = 'cancelled';
      job.updatedAt = now();
      this.controllers.get(id)?.abort();
      await this.persist();
    }
    return toStoredJob(job);
  }
  private async execute(input: AiV2Request, job: AiV2Job, controller: AbortController) {
    const signal = controller.signal;
    const timeout = setTimeout(() => controller.abort(), 300_000);
    // 실패한 호출의 사용량도 남도록 응답을 받는 즉시 더한다. 표시는 T-D2에서 한다.
    const onUsage = (usage: AiV2Usage) => {
      job.usage = addUsage(job.usage, usage);
    };
    const update = async (status: AiV2Status) => {
      signal.throwIfAborted();
      job.status = status;
      job.updatedAt = now();
      await this.persist();
    };
    try {
      await update('researching');
      const research = await this.provider.research(input.research, signal, onUsage);
      job.sources = research.sources;
      let repair = '';
      let shapeCode = '';
      for (let attempt = 1; attempt <= aiV2Limits.maxPlanningAttempts; attempt++) {
        job.attempt = attempt;
        await update('planning');
        let output;
        try {
          output = await this.provider.plan(input.planning, research, repair, signal, onUsage);
          shapeCode = '';
        } catch (error) {
          // Worker와 같다: JSON·스키마 해석 실패는 재작성 1회로 보내고 위치 코드만 남긴다.
          if (!isResponseShapeError(error)) {
            throw error;
          }
          shapeCode = shapeErrorCode(error);
          repair = repairInstruction(
            `The output did not match the required JSON schema at ${shapeCode}; follow required fields, enums, string lengths and formats.`,
          );
          continue;
        }
        await update('validating');
        let warnings: string[];
        try {
          warnings = validateAiV2Output(input.planning, output, research.sources);
        } catch (validation) {
          const detail = validation instanceof Error ? validation.message : 'invalid output';
          repair = repairInstruction(detail);
          continue;
        }
        job.result = { output, sources: research.sources, scope: toValidationScope(input.planning), warnings };
        await update('awaiting-decision');
        return;
      }
      throw new Error(shapeCode ? `${shapeExhaustedMessage} (${shapeCode})` : planningExhaustedMessage);
    } catch (error) {
      if (job.status !== 'cancelled') {
        job.status = 'failed';
        job.error = signal.aborted ? '시간 제한 또는 중단으로 완료하지 못했습니다.' : failureText(error);
        job.updatedAt = now();
        await this.persist();
      }
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(job.id);
    }
  }
}
