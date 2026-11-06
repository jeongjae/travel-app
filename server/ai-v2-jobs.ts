import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson, digestBytes } from '../src/contracts/v2/index.ts';
import {
  aiV2Limits,
  aiV2LocalServer,
  aiV2RequestSchema,
  consentFingerprint,
  type AiV2JobResult,
  type AiV2PlanningDto,
  type AiV2Policy,
  type AiV2Request,
  type AiV2Status,
  type AiV2Usage,
} from '../src/ai-v2-contract.ts';
import { toValidationScope, validateAiV2Output } from '../src/ai-v2-semantics.ts';
import type { AiV2Provider } from './ai-v2.ts';

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
const emptyUsage: AiV2Usage = { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, webSearchCalls: 0 };

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

const running = new Set<AiV2Status>(['queued', 'researching', 'planning', 'validating']);
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
          row.job.error = '서버가 재시작되었습니다. 최신 컨텍스트로 새 요청을 만드세요.';
        }
        this.jobs.set(row.job.id, row);
      }
      await this.persist();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error('v2 AI 작업 저장소를 읽지 못했습니다. 원본 파일을 보존했습니다.');
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
    const input = aiV2RequestSchema.parse(raw);
    const { scope, planning } = input;
    const dayIds = new Set(planning.days.map((day) => day.dayId));
    if (
      planning.fromDate < planning.trip.startDate ||
      planning.fromDate > planning.trip.endDate ||
      planning.days.some((day) => day.date < planning.fromDate || day.date > planning.trip.endDate) ||
      planning.items.some((item) => !dayIds.has(item.dayId))
    ) {
      throw new Error('AI 요청의 여행·계획·선택 날짜가 일치하지 않습니다. 최대 7일을 선택하세요.');
    }
    const policy = this.policy();
    const { fingerprint: agreed, ...agreedPolicy } = input.consent;
    if (agreed !== (await consentFingerprint(input, policy)) || canonicalJson(agreedPolicy) !== canonicalJson(policy)) {
      throw new Error('동의한 전송 내용·서버·모델·한도가 이 요청과 다릅니다. 미리보기를 다시 확인하세요.');
    }
    const fingerprint = await digestBytes(new TextEncoder().encode(canonicalJson(input)));
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
    const addUsage = (usage: AiV2Usage) => {
      job.usage = {
        calls: job.usage.calls + usage.calls,
        inputTokens: job.usage.inputTokens + usage.inputTokens,
        outputTokens: job.usage.outputTokens + usage.outputTokens,
        totalTokens: job.usage.totalTokens + usage.totalTokens,
        webSearchCalls: job.usage.webSearchCalls + usage.webSearchCalls,
      };
    };
    const update = async (status: AiV2Status) => {
      signal.throwIfAborted();
      job.status = status;
      job.updatedAt = now();
      await this.persist();
    };
    try {
      await update('researching');
      const research = await this.provider.research(input.research, signal, addUsage);
      job.sources = research.sources;
      let repair = '';
      for (let attempt = 1; attempt <= aiV2Limits.maxPlanningAttempts; attempt++) {
        job.attempt = attempt;
        await update('planning');
        const output = await this.provider.plan(input.planning, research, repair, signal, addUsage);
        await update('validating');
        let warnings: string[];
        try {
          warnings = validateAiV2Output(input.planning, output, research.sources);
        } catch (validation) {
          const detail = validation instanceof Error ? validation.message : 'invalid output';
          repair = `The proposal failed local date/reference/time/shape checks: ${detail} Recheck known activity/place/day IDs, arrival/departure and fixed time windows, and cited source URLs; preserve untouched fields.`;
          continue;
        }
        job.result = { output, sources: research.sources, scope: toValidationScope(input.planning), warnings };
        await update('awaiting-decision');
        return;
      }
      throw new Error('2회 작성 후에도 날짜·참조·변경안 검증을 통과하지 못했습니다.');
    } catch (error) {
      if (job.status !== 'cancelled') {
        job.status = 'failed';
        job.error = signal.aborted
          ? '시간 제한 또는 중단으로 완료하지 못했습니다.'
          : error instanceof Error && error.name !== 'ZodError' && error.name !== 'SyntaxError'
            ? error.message
            : 'AI 응답 형식을 처리하지 못했습니다.';
        job.updatedAt = now();
        await this.persist();
      }
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(job.id);
    }
  }
}
