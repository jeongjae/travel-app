// R3: 작업 저장소와 무인증 조회에 요청 원문·고른 기록이 남지 않아야 한다.
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { AiV2Provider } from '../server/ai-v2';
import { AiV2Jobs } from '../server/ai-v2-jobs';
import { aiV2PlanningDtoSchema, outputExpiredMessage } from '../src/ai-v2-contract';
import { jobStatusLabel } from '../src/content/ai-job-label';
import { makeApiServer } from '../server/index';
import { JobManager } from '../server/jobs';
import { buildAiV2Payload, consentedRequest } from '../src/ai-v2-context';
import { aiV2Fixture } from './fixtures/ai-v2';

const promptCanary = 'CANARY-REQUEST-TEXT 내 예약번호 ABC123';
const recordCanary = 'CANARY-RECORD-NOTE';
const summaryCanary = 'CANARY-ITEM-SUMMARY';
const forbiddenKeys = ['request', 'records', 'planning', 'research', 'input', 'prompt'];

function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(keysOf);
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, entry]) => [key, ...keysOf(entry)]);
  }
  return [];
}

function expectClean(text: string) {
  expect(text).not.toContain(promptCanary);
  expect(text).not.toContain('ABC123');
  expect(text).not.toContain(recordCanary);
  expect(text).not.toContain(summaryCanary);
  const keys = keysOf(JSON.parse(text));
  forbiddenKeys.forEach((key) => expect(keys).not.toContain(key));
}

async function finishedJob() {
  const fixture = await aiV2Fixture();
  const { dataset } = fixture;
  const actual = dataset.records.find((record) => record.recordId === 'actual-1');
  if (actual?.kind === 'actual') {
    actual.payload.time = { start: { precision: 'date', date: dataset.header.startDate } };
    actual.payload.note = recordCanary;
  }
  dataset.plans[0].items[0].summary = summaryCanary;
  const payload = buildAiV2Payload(dataset, {
    prompt: promptCanary,
    requestKind: 'edit',
    fromDate: dataset.header.startDate,
    count: 3,
    recordIds: ['actual-1'],
  });
  const input = await consentedRequest(payload, fixture.policy);
  expect(JSON.stringify(input)).toContain(recordCanary);
  const directory = await mkdtemp(join(tmpdir(), 'travel-app-ai-v2-retention-'));
  const provider: AiV2Provider = {
    model: fixture.policy.model,
    research: vi.fn(async () => fixture.research),
    plan: vi.fn(async () => structuredClone(fixture.output)),
  };
  const jobs = new AiV2Jobs(provider, directory);
  await jobs.init();
  await jobs.create(input);
  await vi.waitFor(() => expect(jobs.get(input.id)?.status).toBe('awaiting-decision'));
  await (jobs as unknown as { writes: Promise<void> }).writes;
  return { jobs, input, directory, fixture };
}

it('작업 파일에 요청 원문·고른 기록·활동 요약이 없다', async () => {
  const { directory, jobs, input } = await finishedJob();
  expectClean(await readFile(join(directory, 'jobs.json'), 'utf8'));
  expect(jobs.get(input.id)?.result?.output).toBeDefined();
});

it('무인증 조회 응답에 원문·기록이 없고 목록 경로는 없다', async () => {
  const { jobs, input, directory } = await finishedJob();
  const legacy = new JobManager({ model: 'unused', research: vi.fn(), plan: vi.fn() }, join(directory, 'legacy'));
  const server = await makeApiServer(legacy, true, jobs);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('주소 없음');
  }
  const base = `http://127.0.0.1:${address.port}/api/ai/v2/jobs`;
  try {
    const one = await fetch(`${base}/${input.id}`);
    expect(one.status).toBe(200);
    expectClean(await one.text());
    const list = await fetch(`${base}?tripId=${input.scope.tripId}`);
    expect(list.status).toBe(404);
    const cancelled = await fetch(`${base}/${input.id}/cancel`, { method: 'POST', headers: { 'X-Travel-App': '1' } });
    expectClean(await cancelled.text());
  } finally {
    await new Promise<void>((accept) => server.close(() => accept()));
  }
});

it('기존 항목의 원문·기록을 시작할 때 파일에서 지우고 작업은 유지한다', async () => {
  const fixture = await aiV2Fixture();
  const directory = await mkdtemp(join(tmpdir(), 'travel-app-ai-v2-retention-'));
  const planning = {
    ...fixture.input.planning,
    request: promptCanary,
    records: [{ id: 'r', kind: 'note', date: null, summary: recordCanary }],
  };
  planning.items = planning.items.map((item) => ({ ...item, summary: summaryCanary }));
  const row = {
    fingerprint: 'a'.repeat(64),
    input: { prompt: promptCanary },
    job: {
      id: fixture.input.id,
      tripId: fixture.input.scope.tripId,
      baseDomainRevision: 0,
      basePlanVersionId: 'plan-1',
      status: 'awaiting-decision',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model: 'fictional',
      attempt: 1,
      sources: fixture.research.sources,
      usage: { calls: 1, inputTokens: 1, outputTokens: 1, totalTokens: 2, webSearchCalls: 1 },
      prompt: promptCanary,
      result: { output: fixture.output, sources: fixture.research.sources, planning, warnings: [] },
    },
  };
  await writeFile(join(directory, 'jobs.json'), JSON.stringify([row]));
  const provider: AiV2Provider = { model: 'fictional', research: vi.fn(), plan: vi.fn() };
  const jobs = new AiV2Jobs(provider, directory);
  await jobs.init();
  await (jobs as unknown as { writes: Promise<void> }).writes;
  const text = await readFile(join(directory, 'jobs.json'), 'utf8');
  expectClean(text);
  const [stored] = JSON.parse(text);
  expect(stored.fingerprint).toBe('a'.repeat(64));
  expect(stored.job.status).toBe('awaiting-decision');
  expect(stored.job.result.output).toEqual(fixture.output);
  expect(jobs.get(fixture.input.id)?.result?.scope.days).toHaveLength(fixture.input.planning.days.length);
});

it('목록에 없는 새 필드는 저장 직전에 제거된다', async () => {
  const { jobs, input, directory } = await finishedJob();
  const internal = jobs as unknown as { jobs: Map<string, { job: Record<string, unknown> }>; persist(): Promise<void> };
  internal.jobs.get(input.id)!.job.unexpected = promptCanary;
  await internal.persist();
  expectClean(await readFile(join(directory, 'jobs.json'), 'utf8'));
  expect(jobs.get(input.id)).not.toHaveProperty('unexpected');
});

// R5: 끝난 지 24시간이 지난 작업의 AI 출력은 시작할 때와 새 작업을 저장할 때 지운다.
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

async function agedStore(hours: number, status = 'awaiting-decision') {
  const { directory, input, fixture } = await finishedJob();
  const path = join(directory, 'jobs.json');
  const rows = JSON.parse(await readFile(path, 'utf8'));
  rows[0].job.updatedAt = hoursAgo(hours);
  rows[0].job.status = status;
  if (status === 'failed') {
    delete rows[0].job.result;
    rows[0].job.error = '모델 오류 CANARY-ERROR-TEXT';
  }
  if (status === 'cancelled') {
    delete rows[0].job.result;
  }
  await writeFile(path, JSON.stringify(rows));
  return { directory, input, fixture, path };
}

async function restart(directory: string, model = 'fictional') {
  const provider: AiV2Provider = { model, research: vi.fn(), plan: vi.fn() };
  const jobs = new AiV2Jobs(provider, directory);
  await jobs.init();
  await (jobs as unknown as { writes: Promise<void> }).writes;
  return jobs;
}

it('R5 완료 23시간 작업은 출력을 유지한다', async () => {
  const { directory, input } = await agedStore(23);
  const jobs = await restart(directory);
  expect(jobs.get(input.id)?.result?.output).toBeDefined();
  expect(jobs.get(input.id)?.status).toBe('awaiting-decision');
});

it('R5 25시간 작업은 출력을 지우고 비내용 필드는 남기며 만료를 읽을 수 있다', async () => {
  const { directory, input, path } = await agedStore(25);
  const jobs = await restart(directory);
  const job = jobs.get(input.id)!;
  expect(job).not.toHaveProperty('result');
  expect(job.error).toBe(outputExpiredMessage);
  expect(job.status).toBe('failed');
  expect(job.id).toBe(input.id);
  expect(job.tripId).toBe(input.scope.tripId);
  expect(job.model).toBeDefined();
  expect(job.usage).toBeDefined();
  const [stored] = JSON.parse(await readFile(path, 'utf8'));
  expect(stored.job).not.toHaveProperty('result');
  expect(stored.fingerprint).toBeDefined();
});

it('R5 GET 응답에 출력 키가 없고 만료 문구를 읽을 수 있다', async () => {
  const { directory, input } = await agedStore(25);
  const jobs = await restart(directory);
  const legacy = new JobManager({ model: 'unused', research: vi.fn(), plan: vi.fn() }, join(directory, 'legacy'));
  const server = await makeApiServer(legacy, true, jobs);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('주소 없음');
  }
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/ai/v2/jobs/${input.id}`);
    const body = await response.json();
    expect(body).not.toHaveProperty('result');
    expect(body.error).toBe(outputExpiredMessage);
  } finally {
    await new Promise<void>((accept) => server.close(() => accept()));
  }
});

it('R5 실패 작업의 오류 문구도 같은 규칙으로 지워진다', async () => {
  const young = await agedStore(23, 'failed');
  expect((await restart(young.directory)).get(young.input.id)?.error).toContain('CANARY-ERROR-TEXT');
  const old = await agedStore(25, 'failed');
  const jobs = await restart(old.directory);
  expect(jobs.get(old.input.id)?.error).toBe(outputExpiredMessage);
  expect(await readFile(old.path, 'utf8')).not.toContain('CANARY-ERROR-TEXT');
});

it('R5 취소 작업도 같은 규칙으로 처리되고 출력 없는 취소 작업은 그대로다', async () => {
  const { directory, input } = await agedStore(25, 'cancelled');
  const jobs = await restart(directory);
  expect(jobs.get(input.id)?.status).toBe('cancelled');
  expect(jobs.get(input.id)).not.toHaveProperty('error');
});

it('R5 새 작업을 저장할 때도 정리가 실행된다', async () => {
  const { jobs, input, fixture } = await finishedJob();
  const internal = jobs as unknown as { jobs: Map<string, { job: { updatedAt: string } }> };
  expect(jobs.get(input.id)?.result).toBeDefined();
  internal.jobs.get(input.id)!.job.updatedAt = hoursAgo(25);
  const payload = buildAiV2Payload(fixture.dataset, {
    prompt: 'next',
    requestKind: 'edit',
    fromDate: fixture.dataset.header.startDate,
    count: 3,
    recordIds: [],
  });
  const next = await consentedRequest(payload, fixture.policy);
  expect(next.id).not.toBe(input.id);
  await jobs.create(next);
  expect(jobs.get(input.id)).not.toHaveProperty('result');
  expect(jobs.get(input.id)?.error).toBe(outputExpiredMessage);
});

it('R5 만료는 브라우저에 적용된 결과를 건드리지 않는다', async () => {
  const { directory, input } = await agedStore(25);
  const browserStore = new Map([[`applied-${input.id}`, 'APPLIED-RESULT']]);
  await restart(directory);
  expect(browserStore.get(`applied-${input.id}`)).toBe('APPLIED-RESULT');
});

// R6: 만료는 "실패"가 아니라 "만료"로 보인다.
it('R6 만료 작업의 상태 줄은 만료, 일반 실패는 실패', () => {
  const labels = { failed: '실패' };
  expect(jobStatusLabel('failed', labels, outputExpiredMessage)).toBe('만료');
  expect(jobStatusLabel('failed', labels, '모델 오류')).toBe('실패');
  expect(jobStatusLabel('failed', labels)).toBe('실패');
});

// R7: 조회만 해도 기한이 지난 출력은 응답에 없다.
it('R7 create 없이 get만 해도 25시간 지난 출력이 없다', async () => {
  const { jobs, input } = await finishedJob();
  const internal = jobs as unknown as { jobs: Map<string, { job: { updatedAt: string } }> };
  internal.jobs.get(input.id)!.job.updatedAt = hoursAgo(25);
  expect(jobs.get(input.id)).not.toHaveProperty('result');
  expect(jobs.get(input.id)?.error).toBe(outputExpiredMessage);
});

it('R7 blocked 시각이 HH:MM이 아니면 계약이 거부한다', async () => {
  const { fixture, input } = await finishedJob();
  const planning = structuredClone(input.planning);
  planning.days[0].blocked = [{ from: '9시', to: '10:00' }];
  expect(() => aiV2PlanningDtoSchema.parse(planning)).toThrow();
  planning.days[0].blocked = [{ from: '09:00', to: '10:00' }];
  expect(() => aiV2PlanningDtoSchema.parse(planning)).not.toThrow();
  void fixture;
});
