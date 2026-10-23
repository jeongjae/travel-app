import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson, digestBytes } from '../src/contracts/v2/index.ts';
import { aiV2RequestSchema, type AiV2Request, type AiV2Status } from '../src/ai-v2-contract.ts';
import { materializeV2Proposal, type AiV2Provider, type AiV2Result } from './ai-v2.ts';

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
  result?: AiV2Result;
  error?: string;
};
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
      for (const row of rows) {
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
    const data = JSON.stringify([...this.jobs.values()]);
    const write = this.writes.then(async () => {
      const target = join(this.directory, 'jobs.json');
      await writeFile(target + '.tmp', data, { mode: 0o600 });
      await rename(target + '.tmp', target);
    });
    this.writes = write.catch(() => {});
    return write;
  }
  get(id: string) {
    return this.jobs.get(id)?.job;
  }
  list(tripId: string) {
    return [...this.jobs.values()]
      .map((row) => row.job)
      .filter((job) => job.tripId === tripId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async create(raw: unknown) {
    const input = aiV2RequestSchema.parse(raw);
    const { header, plan } = input.context;
    if (
      header.tripId !== plan.tripId ||
      header.currentPlanVersionId !== plan.planVersionId ||
      input.fromDate < header.startDate ||
      input.fromDate > header.endDate ||
      !plan.days.length ||
      plan.days.length > 7 ||
      plan.days.some(
        (day) =>
          day.tripId !== header.tripId ||
          day.planVersionId !== plan.planVersionId ||
          day.date < input.fromDate ||
          day.date > header.endDate,
      ) ||
      plan.items.some(
        (item) =>
          item.tripId !== header.tripId ||
          item.planVersionId !== plan.planVersionId ||
          !plan.days.some((day) => day.dayId === item.dayId),
      )
    ) {
      throw new Error('AI 요청의 여행·계획·선택 날짜가 일치하지 않습니다. 최대 7일을 선택하세요.');
    }
    const fingerprint = await digestBytes(new TextEncoder().encode(canonicalJson(input)));
    const previous = this.jobs.get(input.id);
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        throw new Error('같은 요청 ID의 내용이 다릅니다.');
      }
      return previous.job;
    }
    if (this.controllers.size >= 2 || this.list(header.tripId).some((job) => running.has(job.status))) {
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
      tripId: header.tripId,
      baseDomainRevision: header.domainRevision,
      basePlanVersionId: plan.planVersionId,
      status: 'queued',
      createdAt: now(),
      updatedAt: now(),
      model: this.provider.model,
      attempt: 0,
      sources: [],
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
    return job;
  }
  async cancel(id: string) {
    const job = this.get(id);
    if (!job) {
      throw new Error('AI 작업이 없습니다.');
    }
    if (running.has(job.status)) {
      job.status = 'cancelled';
      job.updatedAt = now();
      this.controllers.get(id)?.abort();
      await this.persist();
    }
    return job;
  }
  private async execute(input: AiV2Request, job: AiV2Job, controller: AbortController) {
    const signal = controller.signal;
    const timeout = setTimeout(() => controller.abort(), 300_000);
    const update = async (status: AiV2Status) => {
      signal.throwIfAborted();
      job.status = status;
      job.updatedAt = now();
      await this.persist();
    };
    try {
      await update('researching');
      const research = await this.provider.research(input, signal);
      job.sources = research.sources;
      let repair = '';
      for (let attempt = 1; attempt <= 2; attempt++) {
        job.attempt = attempt;
        await update('planning');
        const output = await this.provider.plan(input, research, repair, signal);
        await update('validating');
        try {
          job.result = materializeV2Proposal(input, output, research);
          await update('awaiting-decision');
          return;
        } catch {
          repair =
            'The proposal failed local date/reference/shape checks. Recheck known activity/place/day IDs and cited source URLs; preserve untouched fields.';
        }
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
