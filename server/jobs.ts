import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { aiRequestSchema, type AiRequest, type AiJob } from '../src/ai-contract.ts';
import { canonical, now, validateTrip } from '../src/domain.ts';
import { generateProposal, type AiProvider } from './ai.ts';

export class JobManager {
  provider: AiProvider;
  directory: string;
  jobs = new Map<string, { job: AiJob; fingerprint: string }>();
  controllers = new Map<string, AbortController>();
  private writes: Promise<void> = Promise.resolve();
  constructor(provider: AiProvider, directory: string) {
    this.provider = provider;
    this.directory = directory;
  }
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const stored = JSON.parse(await readFile(join(this.directory, 'jobs.json'), 'utf8')) as Array<{
        job: AiJob;
        fingerprint: string;
      }>;
      for (const row of stored) {
        if (['queued', 'researching', 'planning', 'validating'].includes(row.job.status)) {
          row.job.status = 'interrupted';
          row.job.error = '서버가 재시작되었습니다. 최신 상태로 다시 요청하세요.';
        }
        this.jobs.set(row.job.id, row);
      }
      await this.persist();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error('AI 작업 저장소를 읽을 수 없습니다. 원본 파일을 보존했습니다.');
      }
    }
  }
  private persist() {
    const data = JSON.stringify([...this.jobs.values()]);
    const action = this.writes.then(async () => {
      const target = join(this.directory, 'jobs.json');
      await writeFile(target + '.tmp', data, { mode: 0o600 });
      await rename(target + '.tmp', target);
    });
    this.writes = action.catch(() => {});
    return action;
  }
  async create(raw: unknown) {
    const input = aiRequestSchema.parse(raw);
    validateTrip(input.trip);
    if (input.fromDate < input.trip.startDate || input.fromDate > input.trip.endDate) {
      throw new Error('변경 시작 날짜가 여행 범위 밖입니다.');
    }
    const fingerprint = createHash('sha256').update(canonical(input)).digest('hex');
    const previous = this.jobs.get(input.id);
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        throw new Error('같은 요청 ID의 내용이 다릅니다.');
      }
      return previous.job;
    }
    if (
      this.controllers.size >= 2 ||
      [...this.jobs.values()].some(
        (r) =>
          r.job.tripId === input.trip.id && ['queued', 'researching', 'planning', 'validating'].includes(r.job.status),
      )
    ) {
      throw new Error('이미 진행 중인 작업이 있습니다. 완료하거나 중단한 뒤 요청하세요.');
    }
    if ([...this.jobs.values()].filter((r) => r.job.createdAt.slice(0, 10) === now().slice(0, 10)).length >= 20) {
      throw new Error('오늘의 로컬 AI 작업 한도(20회)에 도달했습니다.');
    }
    if (this.jobs.size >= 200) {
      throw new Error('AI 작업 보관 한도에 도달했습니다. 기존 작업 저장소를 백업하고 관리해 주세요.');
    }
    const job: AiJob = {
      id: input.id,
      tripId: input.trip.id,
      baseRevision: input.trip.revision,
      status: 'queued',
      createdAt: now(),
      updatedAt: now(),
      attempt: 0,
      model: this.provider.model,
      sources: [],
    };
    this.jobs.set(job.id, { job, fingerprint });
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    try {
      await this.persist();
    } catch {
      this.jobs.delete(job.id);
      this.controllers.delete(job.id);
      throw new Error('AI 작업을 저장할 수 없어 실행하지 않았습니다.');
    }
    void this.execute(input, job, controller).catch(() => {
      /* Errors are reflected in the persisted job; no secrets in logs. */
    });
    return job;
  }
  get(id: string) {
    return this.jobs.get(id)?.job;
  }
  async cancel(id: string) {
    const job = this.get(id);
    if (!job) {
      throw new Error('AI 작업을 찾을 수 없습니다.');
    }
    if (!['queued', 'researching', 'planning', 'validating'].includes(job.status)) {
      return job;
    }
    job.status = 'cancelled';
    job.updatedAt = now();
    this.controllers.get(id)?.abort();
    await this.persist();
    return job;
  }
  private async execute(input: AiRequest, job: AiJob, controller: AbortController) {
    const timeout = setTimeout(() => controller.abort(new Error('작업 제한 시간 초과')), 300_000);
    try {
      const result = await generateProposal(
        input,
        this.provider,
        controller.signal,
        async (status, attempt, sources) => {
          controller.signal.throwIfAborted();
          job.status = status;
          job.attempt = attempt;
          job.updatedAt = now();
          if (sources) {
            job.sources = sources;
          }
          await this.persist();
        },
      );
      controller.signal.throwIfAborted();
      Object.assign(job, result, { status: 'awaiting-decision', updatedAt: now() });
      await this.persist();
    } catch (e) {
      if (job.status !== 'cancelled') {
        job.status = 'failed';
        job.error = controller.signal.aborted
          ? '작업이 중단되었거나 제한 시간을 넘었습니다. 최신 상태로 재시도하세요.'
          : e instanceof Error
            ? e.message
            : 'AI 작업을 완료할 수 없습니다.';
        job.updatedAt = now();
        await this.persist();
      }
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(job.id);
    }
  }
}
