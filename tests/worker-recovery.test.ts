// T-D3 §A·§B·§C: 실행 중 원문 임시 저장(inflight)과 재시작 복구, 저장 확인(ACK), 복구 시나리오, tick 예외 격리.
// DO SQL은 node:sqlite, OpenAI는 프로세스 내 가짜로 대신한다. workerd 동작은 E2E(ai-d03-recovery)에서 본다.
import { expect, it } from 'vitest';
import { consentedRequest } from '../src/ai-v2-context';
import { aiV2JobLimits, aiV2Limits, aiV2WorkerServer, type AiV2Policy, type AiV2Status } from '../src/ai-v2-contract';
import type { AiV2RequestError } from '../src/ai-v2-jobs-core';
import {
  internalErrorMessage,
  interruptedMessage,
  lostResponseMessage,
  timeoutMessage,
  unknownMessage,
} from '../worker/src/jobs';
import { aiV2Fixture } from './fixtures/ai-v2';
import { workerHarness } from './worker/harness';

const workerPolicy = (): AiV2Policy => ({
  server: aiV2WorkerServer,
  model: 'fictional-model',
  limits: { ...aiV2Limits },
});

type Harness = ReturnType<typeof workerHarness>;

// 여행 표본과 동의 요청은 시험마다 같으므로 한 번만 만든다(다른 시험 파일의 시간 제한을 흔들지 않게 CPU를 아낀다).
const shared = (async () => {
  const fixture = await aiV2Fixture();
  return { fixture, request: await consentedRequest(fixture.payload, workerPolicy()) };
})();

async function setup() {
  const { fixture, request } = await shared;
  const harness = workerHarness();
  harness.openai.outputs = [fixture.output];
  return { fixture, harness, request: structuredClone(request) };
}

/** 다른 여행의 같은 내용 요청. 여행마다 실행 중 1건 제한이 있어 두 작업을 함께 돌릴 때 쓴다. */
async function otherTripRequest(fixture: Awaited<ReturnType<typeof aiV2Fixture>>) {
  return consentedRequest(
    { ...fixture.payload, id: crypto.randomUUID(), scope: { ...fixture.payload.scope, tripId: 'other-trip' } },
    workerPolicy(),
  );
}

async function rejection(promise: Promise<unknown> | (() => unknown)) {
  try {
    await (typeof promise === 'function' ? promise() : promise);
  } catch (error) {
    return error as AiV2RequestError;
  }
  throw new Error('거절되지 않았습니다.');
}

const creates = (harness: Harness) =>
  harness.openai.calls.filter((call) => call.method === 'POST' && call.path === '/v1/responses');
const cancels = (harness: Harness) => harness.openai.calls.filter((call) => call.path.endsWith('/cancel'));

/** 작업을 queued·researching·planning 중 한 상태에 멈춰 둔다. */
async function holdAt(harness: Harness, target: 'queued' | 'researching' | 'planning') {
  harness.openai.hold = true;
  if (target === 'queued') {
    return;
  }
  await harness.app.jobs.tick(); // 조사 생성 → researching
  if (target === 'planning') {
    harness.openai.hold = false;
    await harness.app.jobs.tick(); // 조사 완료 → 작성 생성 → planning
    harness.openai.hold = true;
  }
}

for (const target of ['queued', 'researching', 'planning'] as const) {
  it(`A: ${target}에서 Worker가 다시 떠도 inflight에서 복원해 awaiting-decision까지 가고 inflight는 0행`, async () => {
    const { harness, request, fixture } = await setup();
    await harness.app.jobs.create(request);
    await holdAt(harness, target);
    expect(harness.app.jobs.get(request.id)?.status).toBe(target);
    expect(harness.rawInflight()).toHaveLength(1);
    const before = creates(harness).length;
    harness.restart();
    harness.openai.hold = false;
    await harness.drain();
    const job = harness.app.jobs.get(request.id)!;
    expect(job.status).toBe('awaiting-decision');
    expect(job.result?.output).toEqual(fixture.output);
    // 재시작이 외부 생성을 되풀이하지 않는다: 조사 1회 + 작성 1회.
    expect(creates(harness)).toHaveLength(2);
    expect(creates(harness).length - before).toBe(target === 'planning' ? 0 : target === 'researching' ? 1 : 2);
    expect(harness.rawInflight()).toEqual([]);
    expect(harness.app.jobs.status().usageToday).toEqual({ jobs: 1, totalTokens: 300 });
  });
}

it('A: inflight 행은 실행 중에만 있고 원문·조사 본문을 담으며 GET 응답에는 나가지 않는다', async () => {
  const { harness, request } = await setup();
  await harness.app.jobs.create(request);
  await holdAt(harness, 'planning');
  const [row] = harness.rawInflight();
  expect(row.job_id).toBe(request.id);
  expect(row.input).toContain(request.planning.request);
  expect(row.research).toContain('가상 조사 결과');
  // 실행 중 원문도 전송 집합 그대로다: 예약·현장 메모 표식은 들어오지 않는다.
  expect(JSON.stringify(row)).not.toContain('SYNTHETIC-PRIVATE');
  expect(JSON.stringify(harness.rawJobs())).not.toContain(request.planning.request);
  expect(JSON.stringify(harness.app.jobs.get(request.id))).not.toContain(request.planning.request);
});

const terminalPaths: { name: string; status: AiV2Status; run: (harness: Harness, id: string) => Promise<void> }[] = [
  {
    name: '작성 완료',
    status: 'awaiting-decision',
    run: (harness) => harness.drain(),
  },
  {
    name: '중단',
    status: 'cancelled',
    run: async (harness, id) => {
      harness.openai.hold = true;
      await harness.app.jobs.tick();
      await harness.app.jobs.cancel(id);
    },
  },
  {
    name: '생성 거부(429)',
    status: 'failed',
    run: async (harness) => {
      harness.openai.createStatus = 429;
      await harness.drain();
    },
  },
  {
    name: '결과 불명',
    status: 'unknown',
    run: async (harness) => {
      harness.openai.dropNextCreate = true;
      await harness.drain();
    },
  },
  {
    name: '시간 상한',
    status: 'failed',
    run: async (harness) => {
      harness.openai.hold = true;
      await harness.app.jobs.tick();
      harness.clock.now += aiV2JobLimits.jobTimeoutMs + 1;
      await harness.drain();
    },
  },
  {
    name: '응답 incomplete',
    status: 'failed',
    run: async (harness) => {
      harness.openai.incomplete = true;
      await harness.drain();
    },
  },
  {
    name: '저장 확인(ACK)',
    status: 'acknowledged',
    run: async (harness, id) => {
      await harness.drain();
      harness.app.jobs.acknowledge(id);
    },
  },
];

for (const path of terminalPaths) {
  it(`A: ${path.name}(${path.status})로 끝나면 같은 쓰기에서 inflight 행이 지워진다`, async () => {
    const { harness, request } = await setup();
    await harness.app.jobs.create(request);
    expect(harness.rawInflight()).toHaveLength(1);
    await path.run(harness, request.id);
    expect(harness.rawJobs()[0].status).toBe(path.status);
    expect(harness.rawInflight()).toEqual([]);
  });
}

it('A: 끝난 작업의 inflight가 남아 있어도 만료·prune이 지운다', async () => {
  const { harness, request } = await setup();
  await harness.app.jobs.create(request);
  await harness.drain();
  // 이전 버전이 남긴 행을 흉내 낸다.
  harness.app.store.putInflight(request.id, { input: '{}', research: null, repair: '' });
  harness.clock.now += aiV2JobLimits.outputRetentionMs + 1000;
  expect(harness.app.jobs.get(request.id)?.status).toBe('expired');
  expect(harness.rawInflight()).toEqual([]);
  harness.app.store.putInflight(request.id, { input: '{}', research: null, repair: '' });
  harness.app.store.atomic(() => harness.app.store.deleteJob(request.id));
  expect(harness.rawInflight()).toEqual([]);
});

it('A: inflight 행도 없는 이전 형식 실행 중 작업만 interrupted로 끝낸다', async () => {
  const { harness, request } = await setup();
  await harness.app.jobs.create(request);
  harness.sql.exec('DELETE FROM inflight');
  harness.restart();
  await harness.drain();
  const job = harness.app.jobs.get(request.id)!;
  expect(job.status).toBe('interrupted');
  expect(job.error).toBe(interruptedMessage);
  expect(harness.openai.calls).toEqual([]);
});

it('B1: 202 응답 유실 뒤 같은 요청 재전송은 같은 작업, 일일 횟수·외부 생성 추가 없음', async () => {
  const { harness, request } = await setup();
  const first = await harness.app.jobs.create(request);
  await harness.app.jobs.tick();
  const again = await harness.app.jobs.create(structuredClone(request));
  expect(again.id).toBe(first.id);
  expect(again.status).toBe('researching');
  await harness.drain();
  expect(harness.app.jobs.status().usageToday?.jobs).toBe(1);
  expect(creates(harness)).toHaveLength(2);
});

it('B4: ACK는 출력만 지우고 acknowledged로 둔다. 사용량·출처는 남고 24시간 뒤에도 그대로다', async () => {
  const { harness, request, fixture } = await setup();
  await harness.app.jobs.create(request);
  harness.openai.hold = true;
  await harness.app.jobs.tick();
  const early = await rejection(() => harness.app.jobs.acknowledge(request.id));
  expect(early.status).toBe(409);
  harness.openai.hold = false;
  await harness.drain();
  const acked = harness.app.jobs.acknowledge(request.id);
  expect(acked.status).toBe('acknowledged');
  const job = harness.app.jobs.get(request.id)!;
  expect(job.result).toBeUndefined();
  expect(job.usage.totalTokens).toBe(300);
  expect(job.sources).toEqual(fixture.research.sources);
  expect(harness.rawJobs()[0].data).not.toContain('operations');
  expect(harness.app.jobs.acknowledge(request.id).status).toBe('acknowledged');
  harness.clock.now += aiV2JobLimits.outputRetentionMs + 1000;
  expect(harness.app.jobs.get(request.id)?.status).toBe('acknowledged');
});

it('B4: ACK 전(저장 실패)에는 출력이 남아 다시 회수할 수 있다', async () => {
  const { harness, request, fixture } = await setup();
  await harness.app.jobs.create(request);
  await harness.drain();
  harness.clock.now += 60_000;
  expect(harness.app.jobs.get(request.id)?.result?.output).toEqual(fixture.output);
});

it('B6: calling 중 중단하면 생성 응답 뒤 OpenAI 취소 1회, 재호출 0, cancelled 고정', async () => {
  const { harness, request } = await setup();
  await harness.app.jobs.create(request);
  let release!: () => void;
  harness.openai.createGate = new Promise((resolve) => {
    release = resolve;
  });
  const tick = harness.app.jobs.tick();
  await Promise.resolve();
  expect(harness.rawJobs()[0].status).toBe('calling');
  expect((await harness.app.jobs.cancel(request.id)).status).toBe('cancelled');
  release();
  await tick;
  await harness.app.jobs.tick();
  await harness.app.jobs.tick();
  expect(harness.app.jobs.get(request.id)?.status).toBe('cancelled');
  expect(creates(harness)).toHaveLength(1);
  expect(cancels(harness)).toHaveLength(1);
  expect(harness.rawInflight()).toEqual([]);
});

it('B6: 폴링 중 중단하면 다음 alarm이 취소 1회, 이후 alarm은 아무것도 부르지 않는다', async () => {
  const { harness, request } = await setup();
  await harness.app.jobs.create(request);
  harness.openai.hold = true;
  await harness.app.jobs.tick();
  await harness.app.jobs.cancel(request.id);
  await harness.app.jobs.tick();
  const calls = harness.openai.calls.length;
  await harness.app.jobs.tick();
  expect(harness.openai.calls).toHaveLength(calls);
  expect(cancels(harness)).toHaveLength(1);
  expect(harness.app.jobs.get(request.id)?.status).toBe('cancelled');
});

it('B7: unknown 뒤 다시 요청하면 새 ID로 생성되고 이전 작업은 unknown, 일일 횟수 1 소모', async () => {
  const { harness, request, fixture } = await setup();
  harness.openai.dropNextCreate = true;
  await harness.app.jobs.create(request);
  await harness.drain();
  expect(harness.app.jobs.get(request.id)?.status).toBe('unknown');
  expect(harness.app.jobs.get(request.id)?.error).toBe(unknownMessage);
  const retry = await consentedRequest({ ...fixture.payload, id: crypto.randomUUID() }, workerPolicy());
  await harness.app.jobs.create(retry);
  await harness.drain();
  expect(harness.app.jobs.get(retry.id)?.status).toBe('awaiting-decision');
  expect(harness.app.jobs.get(request.id)?.status).toBe('unknown');
  expect(harness.app.jobs.status().usageToday?.jobs).toBe(2);
});

it('B8: 결과 조회가 404면 failed(보관 만료 문구)', async () => {
  const { harness, request } = await setup();
  await harness.app.jobs.create(request);
  await harness.app.jobs.tick();
  harness.openai.getFailure = { status: 404, times: 1 };
  await harness.app.jobs.tick();
  const job = harness.app.jobs.get(request.id)!;
  expect(job.status).toBe('failed');
  expect(job.error).toBe(lostResponseMessage);
});

it('B8: 결과 조회 5xx는 작업 시간 상한까지 다시 묻고 그 뒤 failed, 외부 생성 재호출 없음', async () => {
  const { harness, request } = await setup();
  await harness.app.jobs.create(request);
  await harness.app.jobs.tick();
  harness.openai.getFailure = { status: 503, times: 1000 };
  for (let index = 0; index < 5; index++) {
    harness.clock.now += 60_000;
    await harness.app.jobs.tick();
    expect(harness.app.jobs.get(request.id)?.status).toBe('researching');
  }
  harness.clock.now += aiV2JobLimits.jobTimeoutMs;
  await harness.app.jobs.tick();
  const job = harness.app.jobs.get(request.id)!;
  expect(job.status).toBe('failed');
  expect(job.error).toBe(timeoutMessage);
  expect(creates(harness)).toHaveLength(1);
});

it('C: 한 작업이 예외를 던져도 다른 작업은 진행하고 alarm은 다시 잡힌다. 예외 문구·입력은 남기지 않는다', async () => {
  const { harness, request, fixture } = await setup();
  const other = await otherTripRequest(fixture);
  await harness.app.jobs.create(request);
  await harness.app.jobs.create(other);
  // 첫 작업의 실행 중 원문을 깨뜨린다: 재시작 뒤 복원에서 SyntaxError가 난다.
  harness.sql.exec('UPDATE inflight SET input = ? WHERE job_id = ?', '{broken', request.id);
  harness.restart();
  harness.openai.hold = true;
  harness.alarms.length = 0;
  await harness.app.jobs.tick();
  expect(harness.app.jobs.get(request.id)?.status).toBe('failed');
  expect(harness.app.jobs.get(request.id)?.error).toBe(internalErrorMessage);
  expect(harness.app.jobs.get(other.id)?.status).toBe('researching');
  expect(harness.alarms).toHaveLength(1);
  harness.openai.hold = false;
  await harness.drain();
  expect(harness.app.jobs.get(other.id)?.status).toBe('awaiting-decision');
  expect(harness.rawInflight()).toEqual([]);
});

it('C: 같은 응답을 두 alarm이 동시에 처리해도 사용량·오늘 합계는 한 번만 더한다', async () => {
  const { harness, request } = await setup();
  await harness.app.jobs.create(request);
  await harness.app.jobs.tick(); // researching
  await Promise.all([harness.app.jobs.tick(), harness.app.jobs.tick()]); // 조사 응답 동시 처리
  expect(harness.app.jobs.get(request.id)?.usage.totalTokens).toBe(150);
  await Promise.all([harness.app.jobs.tick(), harness.app.jobs.tick()]); // 작성 응답 동시 처리
  await harness.drain();
  const job = harness.app.jobs.get(request.id)!;
  expect(job.status).toBe('awaiting-decision');
  expect(job.usage.totalTokens).toBe(300);
  expect(harness.app.jobs.status().usageToday?.totalTokens).toBe(300);
  expect(creates(harness)).toHaveLength(2);
});

it('C: validating에서 재시작하면 같은 응답을 다시 회수하되 사용량은 더하지 않는다', async () => {
  const { harness, request } = await setup();
  await harness.app.jobs.create(request);
  await harness.app.jobs.tick();
  await harness.app.jobs.tick();
  const original = harness.sql.exec.bind(harness.sql);
  let failed = false;
  harness.sql.exec = (query, ...bindings) => {
    if (!failed && bindings.includes('awaiting-decision')) {
      failed = true;
      throw new Error('SQLITE_IOERR: 가상 저장 실패');
    }
    return original(query, ...bindings);
  };
  await harness.app.jobs.tick();
  expect(harness.rawJobs()[0].status).toBe('validating');
  harness.restart();
  await harness.drain();
  expect(harness.app.jobs.get(request.id)?.status).toBe('awaiting-decision');
  expect(harness.app.jobs.status().usageToday?.totalTokens).toBe(300);
  expect(harness.rawInflight()).toEqual([]);
});
