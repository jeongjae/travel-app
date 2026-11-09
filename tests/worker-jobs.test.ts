// T-D2 §C·§D: Worker 작업 저장소·background 폴링·상한. DO SQL은 node:sqlite로, OpenAI는 가짜로 대신한다.
import { expect, it } from 'vitest';
import { consentedRequest } from '../src/ai-v2-context';
import { aiV2JobLimits, aiV2Limits, aiV2WorkerServer, type AiV2Policy } from '../src/ai-v2-contract';
import { limitDay, unknownMessage, interruptedMessage } from '../worker/src/jobs';
import { AiV2RequestError, type AiV2Job } from '../src/ai-v2-jobs-core';
import { aiV2Fixture } from './fixtures/ai-v2';
import { workerHarness } from './worker/harness';

const workerPolicy = (): AiV2Policy => ({
  server: aiV2WorkerServer,
  model: 'fictional-model',
  limits: { ...aiV2Limits },
});

async function setup() {
  const fixture = await aiV2Fixture();
  const harness = workerHarness();
  harness.openai.outputs = [fixture.output];
  const request = await consentedRequest(fixture.payload, workerPolicy());
  return { fixture, harness, request };
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as AiV2RequestError;
  }
  throw new Error('거절되지 않았습니다.');
}

it('요청 처리는 저장과 alarm 예약만 하고 외부 호출은 alarm에서 한다', async () => {
  const { harness, request } = await setup();
  const job = await harness.app.jobs.create(request);
  expect(job.status).toBe('queued');
  expect(harness.openai.calls).toEqual([]);
  expect(harness.alarms).toEqual([harness.clock.now]);
  await harness.app.jobs.tick();
  expect(harness.app.jobs.get(job.id)?.status).toBe('researching');
  expect(harness.openai.bodies[0]).toMatchObject({ background: true, store: false, model: 'fictional-model' });
});

it('조사→작성 background 폴링으로 변경안 대기까지 가고 사용량을 누적한다', async () => {
  const { harness, request, fixture } = await setup();
  harness.openai.pollsBeforeDone = 1;
  await harness.app.jobs.create(request);
  await harness.drain();
  const job = harness.app.jobs.get(request.id)!;
  expect(job.status).toBe('awaiting-decision');
  expect(job.attempt).toBe(1);
  expect(job.result?.output).toEqual(fixture.output);
  expect(job.usage).toEqual({ calls: 2, inputTokens: 240, outputTokens: 60, totalTokens: 300, webSearchCalls: 1 });
  const status = harness.app.jobs.status();
  expect(status.remainingToday).toBe(aiV2JobLimits.dailyJobs - 1);
  expect(status.usageToday).toEqual({ jobs: 1, totalTokens: 300 });
  expect(harness.openai.calls.filter((call) => call.method === 'POST')).toHaveLength(2);
});

it('저장 필드는 허용 목록뿐이다: 요청 원문·기록·활동 제목이 DO 행에 없다', async () => {
  const { harness, request } = await setup();
  await harness.app.jobs.create(request);
  await harness.drain();
  const raw = JSON.stringify(harness.rawJobs());
  expect(raw).not.toContain(request.planning.request);
  expect(raw).not.toContain(request.planning.items[0].title);
  expect(raw).not.toContain('SYNTHETIC-PRIVATE');
  expect(Object.keys(JSON.parse(harness.rawJobs()[0].data!)).sort()).toEqual(
    [
      'attempt',
      'baseDomainRevision',
      'basePlanVersionId',
      'createdAt',
      'id',
      'model',
      'result',
      'sources',
      'status',
      'tripId',
      'updatedAt',
      'usage',
    ].sort(),
  );
});

it('동의 지문이 Worker 정책과 다르면 409로 거절한다(Node 정책으로 동의한 요청)', async () => {
  const { harness, fixture } = await setup();
  const error = await rejection(harness.app.jobs.create(fixture.input));
  expect(error.status).toBe(409);
  expect(error.code).toBe('consent_mismatch');
  expect(harness.rawJobs()).toEqual([]);
});

it('같은 ID 같은 본문은 같은 작업, 다른 본문은 409, 같은 여행 실행 중 1건', async () => {
  const { harness, request, fixture } = await setup();
  const first = await harness.app.jobs.create(request);
  expect((await harness.app.jobs.create(request)).id).toBe(first.id);
  const changed = await consentedRequest(
    { ...fixture.payload, research: { ...fixture.payload.research, question: '다른 질문' } },
    workerPolicy(),
  );
  expect((await rejection(harness.app.jobs.create(changed))).code).toBe('duplicate_mismatch');
  const second = await consentedRequest({ ...fixture.payload, id: crypto.randomUUID() }, workerPolicy());
  expect((await rejection(harness.app.jobs.create(second))).code).toBe('job_running');
  expect(harness.rawJobs()).toHaveLength(1);
});

it('calling이 남은 채 alarm이 다시 돌면 unknown으로 두고 다시 부르지 않는다', async () => {
  const { harness, request } = await setup();
  await harness.app.jobs.create(request);
  // 외부 호출 직전 표시만 남기고 DO가 죽은 상태를 만든다.
  harness.sql.exec("UPDATE jobs SET status = 'calling', data = json_set(data, '$.status', 'calling')");
  harness.restart();
  await harness.drain();
  const job = harness.app.jobs.get(request.id)!;
  expect(job.status).toBe('unknown');
  expect(job.error).toBe(unknownMessage);
  expect(harness.openai.calls).toEqual([]);
});

it('생성 호출 중 연결이 끊기면 unknown이고 자동 재호출은 0회다', async () => {
  const { harness, request } = await setup();
  harness.openai.dropNextCreate = true;
  await harness.app.jobs.create(request);
  await harness.drain();
  expect(harness.app.jobs.get(request.id)?.status).toBe('unknown');
  expect(harness.openai.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
});

it('생성 호출이 429로 거부되면 failed이고 예산/속도 안내를 유지한다', async () => {
  const { harness, request } = await setup();
  harness.openai.createStatus = 429;
  await harness.app.jobs.create(request);
  await harness.drain();
  const job = harness.app.jobs.get(request.id)!;
  expect(job.status).toBe('failed');
  expect(job.error).toContain('잠시 후');
});

it('DO가 다시 떠 요청 원문을 잃으면 interrupted로 끝내고 원문을 저장하지 않았음을 보인다', async () => {
  const { harness, request } = await setup();
  await harness.app.jobs.create(request);
  harness.restart();
  await harness.drain();
  const job = harness.app.jobs.get(request.id)!;
  expect(job.status).toBe('interrupted');
  expect(job.error).toBe(interruptedMessage);
  expect(harness.openai.calls).toEqual([]);
});

it('결과 저장이 실패해도 응답 ID가 남아 다음 alarm에서 다시 회수하고 사용량은 한 번만 더한다', async () => {
  const { harness, request, fixture } = await setup();
  await harness.app.jobs.create(request);
  await harness.app.jobs.tick(); // 조사 생성
  await harness.app.jobs.tick(); // 조사 완료 → 작성 생성
  // 다음 쓰기 중 결과를 담는 쓰기(awaiting-decision)를 한 번 실패시킨다.
  const original = harness.sql.exec.bind(harness.sql);
  let failed = false;
  harness.sql.exec = (query, ...bindings) => {
    if (!failed && bindings.includes('awaiting-decision')) {
      failed = true;
      throw new Error('SQLITE_IOERR: 가상 저장 실패');
    }
    return original(query, ...bindings);
  };
  await expect(harness.app.jobs.tick()).rejects.toThrow('가상 저장 실패');
  const pending = harness.rawJobs()[0];
  expect(pending.status).toBe('validating');
  expect(pending.response_id).toBeTruthy();
  await harness.drain();
  const job = harness.app.jobs.get(request.id)!;
  expect(job.status).toBe('awaiting-decision');
  expect(job.result?.output).toEqual(fixture.output);
  expect(job.usage.calls).toBe(2);
  expect(harness.app.jobs.status().usageToday?.totalTokens).toBe(300);
});

it('검증 실패면 수정 지시로 한 번 더 작성하고 두 번째도 실패하면 failed', async () => {
  const { harness, request, fixture } = await setup();
  const broken = structuredClone(fixture.output);
  broken.operations[0].dayId = 'missing-day';
  harness.openai.outputs = [broken, broken];
  await harness.app.jobs.create(request);
  await harness.drain();
  const job = harness.app.jobs.get(request.id)!;
  expect(job.status).toBe('failed');
  expect(job.attempt).toBe(2);
  const planningBodies = harness.openai.bodies.filter((body) => !body.tools);
  expect(planningBodies).toHaveLength(2);
  expect(String(planningBodies[1].input)).toContain('failed local date/reference/time/shape checks');
});

it('중단하면 cancelled가 되고 다음 alarm이 OpenAI 쪽 취소를 보낸다', async () => {
  const { harness, request } = await setup();
  harness.openai.hold = true;
  await harness.app.jobs.create(request);
  await harness.app.jobs.tick();
  const cancelled = await harness.app.jobs.cancel(request.id);
  expect(cancelled.status).toBe('cancelled');
  await harness.app.jobs.tick();
  expect(harness.openai.calls.at(-1)).toEqual({ method: 'POST', path: '/v1/responses/resp_1/cancel' });
  expect(harness.rawJobs()[0].response_id).toBeNull();
});

it('작업 시간 상한을 넘으면 failed로 끝낸다', async () => {
  const { harness, request } = await setup();
  harness.openai.hold = true;
  await harness.app.jobs.create(request);
  await harness.app.jobs.tick();
  harness.clock.now += aiV2JobLimits.jobTimeoutMs + 1;
  await harness.drain();
  expect(harness.app.jobs.get(request.id)?.status).toBe('failed');
});

it('완료 24시간 뒤 조회하면 출력을 지우고 expired로 저장한다', async () => {
  const { harness, request } = await setup();
  await harness.app.jobs.create(request);
  await harness.drain();
  harness.clock.now += aiV2JobLimits.outputRetentionMs - 1000;
  expect(harness.app.jobs.get(request.id)?.result).toBeDefined();
  harness.clock.now += 2000;
  const job = harness.app.jobs.get(request.id)!;
  expect(job.status).toBe('expired');
  expect(job.result).toBeUndefined();
  expect(job.error).toBeUndefined();
  expect(harness.rawJobs()[0].status).toBe('expired');
  expect(harness.rawJobs()[0].data).not.toContain('operations');
});

it('보관 200건이 차면 가장 오래된 만료 작업부터 지운다', async () => {
  const { harness, request } = await setup();
  const template: AiV2Job = {
    id: '',
    tripId: 'other-trip',
    baseDomainRevision: 1,
    basePlanVersionId: 'plan',
    status: 'failed',
    createdAt: '',
    updatedAt: new Date(harness.clock.now).toISOString(),
    model: 'm',
    attempt: 0,
    sources: [],
    usage: { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, webSearchCalls: 0 },
  };
  for (let index = 0; index < aiV2JobLimits.maxStoredJobs; index++) {
    const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    const createdAt = new Date(Date.parse('2026-10-01T00:00:00Z') + index * 1000).toISOString();
    const status = index === 5 || index === 7 ? 'expired' : 'failed';
    harness.app.store.putJob({ ...template, id, createdAt, status }, 'fp', null);
  }
  await harness.app.jobs.create(request);
  const ids = harness.rawJobs().map((row) => row.id);
  expect(ids).toHaveLength(aiV2JobLimits.maxStoredJobs);
  expect(ids).not.toContain('00000000-0000-4000-8000-000000000005');
  expect(ids).toContain('00000000-0000-4000-8000-000000000007');
  expect(ids).toContain('00000000-0000-4000-8000-000000000000');
});

it('일일 한도는 Asia/Seoul 날짜로 센다: 23:59:59 KST에 막히고 00:00 KST에 풀린다', async () => {
  const { harness, request } = await setup();
  harness.clock.now = Date.parse('2026-11-09T14:59:59Z');
  expect(limitDay(harness.clock.now)).toBe('2026-11-09');
  expect(limitDay(Date.parse('2026-11-09T15:00:00Z'))).toBe('2026-11-10');
  harness.app.store.addDaily('2026-11-09', aiV2JobLimits.dailyJobs, 0);
  expect(harness.app.jobs.status().remainingToday).toBe(0);
  const error = await rejection(harness.app.jobs.create(request));
  expect(error.status).toBe(429);
  expect(error.code).toBe('daily_limit');
  harness.clock.now = Date.parse('2026-11-09T15:00:00Z');
  expect((await harness.app.jobs.create(request)).status).toBe('queued');
  expect(harness.app.jobs.status().remainingToday).toBe(aiV2JobLimits.dailyJobs - 1);
});
