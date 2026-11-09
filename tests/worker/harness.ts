// Worker 로직을 Node에서 돌리는 시험 도구. DO SQL 대신 node:sqlite, OpenAI 대신 프로세스 내 가짜 응답을 쓴다.
// workerd 자체의 동작은 E2E(wrangler dev)에서 따로 본다.
import { DatabaseSync } from 'node:sqlite';
import { createApp, type WorkerVars } from '../../worker/src/context.ts';
import type { SqlLike, SqlValue } from '../../worker/src/store.ts';

export function memorySql(): SqlLike & { db: DatabaseSync; failNext?: RegExp } {
  const db = new DatabaseSync(':memory:');
  const adapter: SqlLike & { db: DatabaseSync; failNext?: RegExp } = {
    db,
    exec(query: string, ...bindings: SqlValue[]) {
      if (adapter.failNext?.test(query)) {
        adapter.failNext = undefined;
        throw new Error('SQLITE_IOERR: 가상 저장 실패');
      }
      const rows = db.prepare(query).all(...(bindings as (string | number | null)[]));
      return { toArray: () => rows as Record<string, SqlValue>[] };
    },
  };
  return adapter;
}

export type FakeOpenAi = {
  bodies: Record<string, unknown>[];
  calls: { method: string; path: string }[];
  /** 몇 번의 조회까지 in_progress로 둘지. */
  pollsBeforeDone: number;
  hold: boolean;
  outputs: unknown[];
  sources: { url: string; title: string }[];
  /** 다음 생성 호출을 연결 실패로 만든다. */
  dropNextCreate: boolean;
  createStatus?: number;
  fetcher: typeof fetch;
};

export function fakeOpenAi(): FakeOpenAi {
  const responses = new Map<string, { kind: 'research' | 'planning'; polls: number; index: number }>();
  let planningCalls = 0;
  let sequence = 0;
  const fake: FakeOpenAi = {
    bodies: [],
    calls: [],
    pollsBeforeDone: 0,
    hold: false,
    outputs: [],
    sources: [{ url: 'https://example.org/fictional-official', title: '가상 공식 자료' }],
    dropNextCreate: false,
    fetcher: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      fake.calls.push({ method, path: url.pathname });
      const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
      const usage = { input_tokens: 120, output_tokens: 30, total_tokens: 150 };
      if (method === 'POST' && url.pathname === '/v1/responses') {
        if (fake.dropNextCreate) {
          fake.dropNextCreate = false;
          throw new TypeError('fetch failed');
        }
        if (fake.createStatus) {
          return json({ error: { code: 'rate_limit_exceeded' } }, fake.createStatus);
        }
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        fake.bodies.push(body);
        const id = `resp_${++sequence}`;
        const kind = body.tools ? 'research' : 'planning';
        responses.set(id, { kind, polls: 0, index: kind === 'planning' ? planningCalls++ : 0 });
        return json({ id, status: 'queued' });
      }
      const match = /^\/v1\/responses\/([^/]+)(\/cancel)?$/.exec(url.pathname);
      const stored = match ? responses.get(match[1]) : undefined;
      if (!match || !stored) {
        return json({ error: { message: 'not found' } }, 404);
      }
      if (match[2]) {
        return json({ id: match[1], status: 'cancelled' });
      }
      stored.polls += 1;
      if (fake.hold || stored.polls <= fake.pollsBeforeDone) {
        return json({ id: match[1], status: 'in_progress' });
      }
      if (stored.kind === 'research') {
        return json({
          id: match[1],
          status: 'completed',
          usage,
          output: [
            { type: 'web_search_call', action: { sources: fake.sources } },
            { type: 'message', content: [{ type: 'output_text', text: '가상 조사 결과' }] },
          ],
        });
      }
      const output = fake.outputs[Math.min(stored.index, fake.outputs.length - 1)];
      return json({
        id: match[1],
        status: 'completed',
        usage,
        output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
      });
    },
  };
  return fake;
}

export const testVars: WorkerVars = {
  OPENAI_API_KEY: 'fictional-key',
  OPENAI_BASE: 'https://fake-openai.invalid/v1',
  OPENAI_MODEL: 'fictional-model',
  TOKEN_SECRET: 'fictional-token-secret-0123456789abcdef',
  REGISTRATION_CODE: 'fictional-registration-code',
  RP_ID: 'localhost',
  ALLOWED_ORIGINS: 'http://localhost:4173,https://jeongjae.github.io',
};

/** 시계·alarm·SQL을 손에 쥔 Worker 하나. `restart()`는 DO가 내려갔다 다시 뜬 것처럼 메모리만 비운다. */
export function workerHarness(vars: WorkerVars = testVars) {
  const sql = memorySql();
  const openai = fakeOpenAi();
  const clock = { now: Date.parse('2026-11-09T03:00:00.000Z') };
  const alarms: number[] = [];
  const build = () =>
    createApp(vars, {
      sql,
      now: () => clock.now,
      schedule: (at) => {
        alarms.push(at);
      },
      fetcher: openai.fetcher,
    });
  const harness = {
    sql,
    openai,
    clock,
    alarms,
    app: build(),
    restart() {
      harness.app = build();
    },
    /** 실행 중 작업이 없어질 때까지(최대 n회) alarm을 돌린다. */
    async drain(limit = 20) {
      for (let index = 0; index < limit; index++) {
        await harness.app.jobs.tick();
        const running = harness.sql.db
          .prepare(
            "SELECT count(*) AS n FROM jobs WHERE status IN ('queued','calling','researching','planning','validating')",
          )
          .get() as { n: number };
        if (!running.n) {
          return;
        }
      }
    },
    rawJobs() {
      return harness.sql.db.prepare('SELECT * FROM jobs').all() as Record<string, string | null>[];
    },
  };
  return harness;
}
