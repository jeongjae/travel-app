import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { demoTrips } from '../src/demo';
import { uid, currentPlan } from '../src/domain';
import { generateProposal, collectedSources, validateAiProposal, type AiProvider, type Research } from '../server/ai';
import { JobManager } from '../server/jobs';
import { makeApiServer } from '../server/index';
import type { AiRequest, ModelPlan } from '../src/ai-contract';

const dirs: string[] = [];
afterEach(async () => {
  for (const path of dirs.splice(0)) await rm(path, { recursive: true, force: true });
});
const request = (): AiRequest => ({
  id: uid(),
  trip: demoTrips()[0],
  fromDate: '2026-11-07',
  prompt: '현장 상황을 반영해 내일 일정을 조사해 주세요.',
});
const research: Research = {
  text: '테스트용 공식 자료 요약',
  sources: [{ url: 'https://example.org/official', title: '가상 공식 자료' }],
};
function output(input: AiRequest): ModelPlan {
  const a = currentPlan(input.trip).activities[0];
  return {
    reason: '가상 근거에 따른 조정',
    reservationImpact: '예약 영향 없음',
    operations: [
      {
        type: 'upsert',
        activityId: a.id,
        title: '변경된 아침 일정',
        start: a.start,
        end: a.end,
        timeZone: a.timeZone,
        note: '불확실한 정보는 재확인 필요',
        placeId: null,
      },
    ],
    evidence: [
      {
        source: research.sources[0].url,
        claim: '가상 근거',
        appliesFrom: input.trip.startDate,
        appliesTo: input.trip.endDate,
        relatedActivityIds: [a.id],
      },
    ],
  };
}
function provider(input: AiRequest): AiProvider {
  return { model: 'test-model', research: vi.fn(async () => research), plan: vi.fn(async () => output(input)) };
}
async function manager(p: AiProvider) {
  const dir = await mkdtemp(join(tmpdir(), 'travel-ai-test-'));
  dirs.push(dir);
  const m = new JobManager(p, dir);
  await m.init();
  return m;
}
async function finished(m: JobManager, id: string) {
  await vi.waitFor(() => expect(['awaiting-decision', 'failed', 'cancelled']).toContain(m.get(id)?.status));
  return m.get(id)!;
}
it('실제 조사 출처로 검증된 초안을 만들되 계획과 실제 기록을 변경하지 않는다', async () => {
  const input = request();
  const before = structuredClone(input.trip);
  const p = provider(input);
  const states: string[] = [];
  const result = await generateProposal(input, p, new AbortController().signal, async (s) => {
    states.push(s);
  });
  expect(input.trip).toEqual(before);
  expect(result.proposal.baseRevision).toBe(input.trip.revision);
  expect(result.proposal.evidence[0].status).toBe('unverified');
  expect(states).toEqual(['researching', 'planning', 'validating']);
});
it('구조·도메인 오류는 자동 보정하되 작성은 두 번까지만 시도한다', async () => {
  const input = request(),
    p = provider(input);
  let count = 0;
  p.plan = vi.fn(async () => {
    count++;
    const o = output(input);
    if (count === 1) o.operations[0].end = 'invalid';
    return o;
  });
  await generateProposal(input, p, new AbortController().signal, async () => {});
  expect(p.plan).toHaveBeenCalledTimes(2);
  p.plan = vi.fn(async () => {
    const o = output(input);
    o.evidence[0].source = 'https://invented.test';
    return o;
  });
  await expect(generateProposal(input, p, new AbortController().signal, async () => {})).rejects.toThrow('검증 실패');
  expect(p.plan).toHaveBeenCalledTimes(2);
});
it('인증·과금 한도 오류는 자동 재호출하지 않는다', async () => {
  const input = request(),
    p = provider(input);
  p.plan = vi.fn(async () => {
    throw new Error('OpenAI 사용 한도를 확인하세요.');
  });
  await expect(generateProposal(input, p, new AbortController().signal, async () => {})).rejects.toThrow('OpenAI');
  expect(p.plan).toHaveBeenCalledTimes(1);
});
it('변경 시작일 이전 일정과 조사하지 않은 URL을 거부한다', () => {
  const input = request();
  input.fromDate = '2026-11-08';
  expect(() => validateAiProposal(input, output(input), research)).toThrow('이전');
  input.fromDate = '2026-11-07';
  const o = output(input);
  o.evidence[0].source = 'https://invented.test';
  expect(() => validateAiProposal(input, o, research)).toThrow('출처');
});
it('같은 작업 ID의 재요청은 유료 호출을 반복하지 않고 저장된 결과를 재시작 후 복원한다', async () => {
  const input = request(),
    p = provider(input),
    m = await manager(p);
  await m.create(input);
  await m.create(input);
  const job = await finished(m, input.id);
  expect(job.status).toBe('awaiting-decision');
  expect(p.research).toHaveBeenCalledTimes(1);
  expect(p.plan).toHaveBeenCalledTimes(1);
  const reopened = new JobManager(p, m.directory);
  await reopened.init();
  expect(reopened.get(input.id)?.proposal).toEqual(job.proposal);
  await expect(m.create({ ...input, prompt: '다른 내용' })).rejects.toThrow('같은 요청 ID');
});
it('진행 작업 중단은 저장되며 늦게 도착한 결과로 덮어쓰지 않는다', async () => {
  const input = request(),
    p = provider(input);
  let finish!: (r: Research) => void;
  p.research = vi.fn(
    () =>
      new Promise<Research>((resolve) => {
        finish = resolve;
      }),
  );
  const m = await manager(p);
  await m.create(input);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  await m.cancel(input.id);
  finish(research);
  await vi.waitFor(() => expect(m.controllers.size).toBe(0));
  expect(m.get(input.id)?.status).toBe('cancelled');
  expect(p.plan).not.toHaveBeenCalled();
});
it('서버 재시작 시 진행 중 작업은 interrupted로 표시하고 재과금하지 않는다', async () => {
  const input = request(),
    p = provider(input),
    m = await manager(p);
  await writeFile(
    join(m.directory, 'jobs.json'),
    JSON.stringify([
      { fingerprint: 'test', job: { id: input.id, tripId: input.trip.id, status: 'researching', sources: [] } },
    ]),
  );
  const reopened = new JobManager(p, m.directory);
  await reopened.init();
  expect(reopened.get(input.id)?.status).toBe('interrupted');
  expect(p.research).not.toHaveBeenCalled();
});
it('API는 키 값을 노출하지 않고 외부 Origin 및 앱 헤더 없는 쓰기를 거부한다', async () => {
  const input = request(),
    m = await manager(provider(input)),
    server = await makeApiServer(m, true);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const status = await fetch(base + '/api/ai/status').then((r) => r.json());
    expect(status).toEqual({ configured: true, model: 'test-model' });
    expect(
      (await fetch(base + '/api/ai/jobs', { method: 'POST', headers: { Origin: 'https://evil.test' } })).status,
    ).toBe(403);
    expect((await fetch(base + '/api/ai/jobs', { method: 'POST' })).status).toBe(403);
    const created = await fetch(base + '/api/ai/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Travel-App': '1' },
      body: JSON.stringify(input),
    });
    expect(created.status).toBe(202);
    await finished(m, input.id);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
it('출처 수집은 웹 URL만 허용하고 중복을 제거한다', () => {
  expect(
    collectedSources({
      output: [
        {
          type: 'web_search_call',
          action: {
            sources: [
              { url: 'https://example.org/official' },
              { url: 'javascript:bad' },
              { url: 'https://user:pass@example.org' },
            ],
          },
          content: [
            { type: 'output_text', annotations: [{ type: 'url_citation', url: 'https://example.org/official' }] },
          ],
        },
      ],
    }),
  ).toHaveLength(1);
});
