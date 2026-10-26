import { expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { once } from 'node:events';
import { AiV2Jobs } from '../server/ai-v2-jobs';
import { materializeV2Proposal, type AiV2Provider } from '../server/ai-v2';
import { JobManager } from '../server/jobs';
import { makeApiServer } from '../server/index';
import { buildAiV2Request } from '../src/ai-v2-context';
import { aiV2Fixture } from './fixtures/ai-v2';
import type { Research } from '../server/ai';

async function setup() {
  const fixture = await aiV2Fixture();
  await mkdir('.cache/ai-v2-tests', { recursive: true });
  const directory = await mkdtemp(resolve('.cache/ai-v2-tests/jobs-'));
  const provider: AiV2Provider = {
    model: 'fictional-v2-provider',
    research: vi.fn(async () => fixture.research),
    plan: vi.fn(async () => structuredClone(fixture.output)),
  };
  const jobs = new AiV2Jobs(provider, directory);
  await jobs.init();
  return { ...fixture, provider, jobs, directory };
}

async function persisted(jobs: AiV2Jobs, directory: string, id: string, status: string) {
  await vi.waitFor(() => expect(jobs.get(id)?.status).toBe(status), { timeout: 5000 });
  // A restarted process reads after the prior writer has finished, not while it renames its file.
  await (jobs as unknown as { writes: Promise<void> }).writes;
  const rows = JSON.parse(await readFile(join(directory, 'jobs.json'), 'utf8'));
  expect(rows.find((row: { job: { id: string } }) => row.job.id === id)?.job.status).toBe(status);
}

it('전송 컨텍스트에서 예약·숙박 상세와 기본 현장 기록을 제외하고 원본을 유지한다', async () => {
  const { dataset } = await aiV2Fixture();
  const before = structuredClone(dataset);
  const request = buildAiV2Request(dataset, '가상 요청', dataset.plans[0].days[1].date, 99, false);
  expect(request.context.plan.days).toHaveLength(2);
  expect(request.context.plan.items.every((item) => item.dayId !== 'day-1')).toBe(true);
  expect(request.context.plan.stays).toEqual([]);
  expect(request.context.plan.contextRefs).toEqual([]);
  expect(request.context.records).toEqual([]);
  const encoded = JSON.stringify(buildAiV2Request(dataset, '가상 요청', dataset.header.startDate, 3, false));
  expect(encoded).not.toContain('SYNTHETIC-PRIVATE-RESERVATION');
  expect(encoded).not.toContain('SYNTHETIC-PRIVATE-FIELD-NOTE');
  expect(encoded).not.toContain('privateDetails');
  const withRecords = buildAiV2Request(dataset, '가상 요청', dataset.header.startDate, 3, true);
  expect(withRecords.context.records).toHaveLength(dataset.records.length);
  expect(dataset).toEqual(before);
});

it('시각 미지정 편집은 기존 시각을 유지하고 장소 교체 시 과거 좌표 참조를 제거한다', async () => {
  const { input, output, research } = await aiV2Fixture();
  const same = materializeV2Proposal(input, output, research);
  expect(same.proposal.status).toBe('pending');
  expect(same.proposal.baseDomainRevision).toBe(input.context.header.domainRevision + 1);
  expect(same.proposal.operations[0]).toMatchObject({ item: { time: input.context.plan.items[0].time } });
  output.operations[0].placeId = 'place-2';
  const changed = materializeV2Proposal(input, output, research);
  expect(changed.proposal.operations[0]).toMatchObject({ item: { placeLinks: [{ placeId: 'place-2' }] } });
  expect(changed.proposal.operations[0]).not.toHaveProperty('item.mapTargetId');
  expect(changed.evidence[0].payload).not.toHaveProperty('sourceVerifiedAt');
});

it('새 활동 추가에 기존 활동 ID를 사용해 예약·작업 참조를 복제하지 못한다', async () => {
  const { input, output, research } = await aiV2Fixture();
  output.operations[0].type = 'add';
  expect(() => materializeV2Proposal(input, output, research)).toThrow('활동 ID');
  output.operations[0].activityId = '';
  const result = materializeV2Proposal(input, output, research);
  expect(result.proposal.operations[0]).toMatchObject({ item: { bookingIds: [], taskRefs: [] } });
});

it.each(['unknown-day', 'unknown-place', 'unknown-activity', 'duplicate-activity', 'invented-source'])(
  '%s인 AI 변경안을 로컬에서 거부한다',
  async (invalid) => {
    const { input, output, research } = await aiV2Fixture();
    if (invalid === 'unknown-day') {
      output.operations[0].dayId = 'missing-day';
    } else if (invalid === 'unknown-place') {
      output.operations[0].placeId = 'missing-place';
    } else if (invalid === 'unknown-activity') {
      output.operations[0].activityId = 'missing-activity';
    } else if (invalid === 'duplicate-activity') {
      output.operations.push(structuredClone(output.operations[0]));
    } else {
      output.evidence[0].url = 'https://example.org/not-researched';
    }
    expect(() => materializeV2Proposal(input, output, research)).toThrow();
  },
);

it('같은 요청은 한 번만 조사·작성하고 저장 파일 재진입 후에도 재호출하지 않는다', async () => {
  const { jobs, provider, input, directory } = await setup();
  await jobs.create(input);
  await jobs.create(structuredClone(input));
  await persisted(jobs, directory, input.id, 'awaiting-decision');
  expect(provider.research).toHaveBeenCalledTimes(1);
  expect(provider.plan).toHaveBeenCalledTimes(1);
  const reopened = new AiV2Jobs(provider, directory);
  await reopened.init();
  expect((await reopened.create(input)).result).toEqual(jobs.get(input.id)?.result);
  await expect(reopened.create({ ...input, prompt: '같은 ID의 다른 내용' })).rejects.toThrow('같은 요청 ID');
  expect(provider.research).toHaveBeenCalledTimes(1);
});

it('도메인 검증 실패만 한 번 보정하고 조사와 작성 횟수의 한도를 유지한다', async () => {
  const { jobs, provider, input, output, directory } = await setup();
  const invalid = structuredClone(output);
  invalid.operations[0].placeId = 'not-in-context';
  provider.plan = vi.fn().mockResolvedValueOnce(invalid).mockResolvedValueOnce(output);
  await jobs.create(input);
  await persisted(jobs, directory, input.id, 'awaiting-decision');
  expect(provider.research).toHaveBeenCalledTimes(1);
  expect(provider.plan).toHaveBeenCalledTimes(2);
  expect(vi.mocked(provider.plan).mock.calls[1][2]).toContain('failed local');
});

it('2회 보정 실패나 provider 오류 뒤 자동 재실행하지 않는다', async () => {
  const { jobs, provider, input, output, directory } = await setup();
  output.evidence[0].url = 'https://example.org/invented';
  provider.plan = vi.fn(async () => output);
  await jobs.create(input);
  await persisted(jobs, directory, input.id, 'failed');
  expect(provider.plan).toHaveBeenCalledTimes(2);
  const other = await setup();
  other.provider.research = vi.fn(async () => {
    throw new Error('가상 한도 오류');
  });
  await other.jobs.create(other.input);
  await persisted(other.jobs, other.directory, other.input.id, 'failed');
  expect(other.provider.research).toHaveBeenCalledTimes(1);
  expect(other.provider.plan).not.toHaveBeenCalled();
});

it('중단 뒤 늦게 도착한 결과가 초안을 만들지 않는다', async () => {
  const { jobs, provider, input, research, directory } = await setup();
  let finish!: (value: Research) => void;
  provider.research = vi.fn(() => new Promise<Research>((accept) => (finish = accept)));
  await jobs.create(input);
  await vi.waitFor(() => expect(provider.research).toHaveBeenCalledOnce());
  await jobs.cancel(input.id);
  finish(research);
  await persisted(jobs, directory, input.id, 'cancelled');
  expect(jobs.get(input.id)?.result).toBeUndefined();
  expect(provider.plan).not.toHaveBeenCalled();
});

it('새 실행기에서 진행 작업을 interrupted로 복원하고 같은 ID 재요청을 재과금하지 않는다', async () => {
  const { jobs, provider, input, research, directory } = await setup();
  let finish!: (value: Research) => void;
  provider.research = vi.fn(() => new Promise<Research>((accept) => (finish = accept)));
  await jobs.create(input);
  await persisted(jobs, directory, input.id, 'researching');
  const reopened = new AiV2Jobs(provider, directory);
  await reopened.init();
  expect((await reopened.create(input)).status).toBe('interrupted');
  expect(provider.research).toHaveBeenCalledTimes(1);
  await jobs.cancel(input.id);
  finish(research);
});

it('작업 파일 저장 실패 시 provider를 시작하지 않으며 손상 파일은 보존한다', async () => {
  const { jobs, provider, input, directory } = await setup();
  await mkdir(join(directory, 'jobs.json'));
  await expect(jobs.create(input)).rejects.toThrow('저장하지 못해');
  expect(provider.research).not.toHaveBeenCalled();
  expect(jobs.get(input.id)).toBeUndefined();
  const corrupt = await setup();
  const original = '{invalid-json';
  await writeFile(join(corrupt.directory, 'jobs.json'), original);
  await expect(new AiV2Jobs(corrupt.provider, corrupt.directory).init()).rejects.toThrow('원본 파일을 보존');
  expect(await readFile(join(corrupt.directory, 'jobs.json'), 'utf8')).toBe(original);
});

it('여행·계획 참조와 날짜 범위를 검사해 provider 실행 전 차단한다', async () => {
  const { jobs, provider, input } = await setup();
  input.context.plan.tripId = 'other-trip';
  await expect(jobs.create(input)).rejects.toThrow('여행·계획');
  expect(provider.research).not.toHaveBeenCalled();
});

it('모의 HTTP 서버가 명시적 비활성·동의 누락·1MiB 초과를 차단한다', async () => {
  const { jobs, provider, input, directory } = await setup();
  const legacy = new JobManager(
    {
      model: 'unused-mock',
      research: vi.fn(),
      plan: vi.fn(),
    },
    join(directory, 'unused-legacy'),
  );
  const disabled = await makeApiServer(legacy, true);
  disabled.listen(0, '127.0.0.1');
  await once(disabled, 'listening');
  const address = disabled.address();
  if (!address || typeof address === 'string') {
    throw new Error('가상 서버 주소 누락');
  }
  const base = `http://127.0.0.1:${address.port}`;
  try {
    expect((await fetch(base + '/api/ai/v2/status').then((response) => response.json())).configured).toBe(false);
    expect((await fetch(base + '/api/ai/v2/jobs', { method: 'POST', headers: { 'X-Travel-App': '1' } })).status).toBe(
      503,
    );
  } finally {
    await new Promise<void>((accept) => disabled.close(() => accept()));
  }
  const server = await makeApiServer(legacy, true, jobs);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const activeAddress = server.address();
  if (!activeAddress || typeof activeAddress === 'string') {
    throw new Error('가상 서버 주소 누락');
  }
  const endpoint = `http://127.0.0.1:${activeAddress.port}/api/ai/v2/jobs`;
  const headers = { 'Content-Type': 'application/json', 'X-Travel-App': '1' };
  try {
    expect(
      (await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ ...input, consent: false }) })).status,
    ).toBe(400);
    expect((await fetch(endpoint, { method: 'POST', headers, body: 'x'.repeat(1024 ** 2 + 1) })).status).toBe(413);
    expect((await fetch(endpoint, { method: 'POST', body: '{}' })).status).toBe(403);
    expect(provider.research).not.toHaveBeenCalled();
  } finally {
    await new Promise<void>((accept) => server.close(() => accept()));
  }
});
