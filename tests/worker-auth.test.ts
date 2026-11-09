// T-D2 §B·§D: 패스키 등록·로그인, Bearer 토큰, Origin·CORS, 본문 상한. 소프트웨어 패스키로 실제 검증 경로를 지난다.
import { expect, it } from 'vitest';
import { aiV2JobLimits } from '../src/ai-v2-contract';
import { handleRequest } from '../worker/src/app';
import { createApp } from '../worker/src/context';
import { softAuthenticator } from './worker/soft-authenticator';
import { testVars, workerHarness } from './worker/harness';

const appOrigin = 'http://localhost:4173';
type Harness = ReturnType<typeof workerHarness>;

function call(
  harness: Harness,
  method: string,
  path: string,
  init: { body?: unknown; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = { Origin: appOrigin, ...init.headers };
  if (method === 'POST') {
    headers['Content-Type'] ??= 'application/json';
  }
  return handleRequest(
    new Request(`http://worker.test${path}`, {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(init.body ?? {}) : undefined,
    }),
    harness.app,
  );
}

async function register(harness: Harness, authenticator: Awaited<ReturnType<typeof softAuthenticator>>) {
  const code = testVars.REGISTRATION_CODE;
  const options = await (await call(harness, 'POST', '/auth/register/options', { body: { code } })).json();
  const response = await authenticator.register(options.challenge, appOrigin);
  return call(harness, 'POST', '/auth/register', { body: { code, response } });
}

async function login(
  harness: Harness,
  authenticator: Awaited<ReturnType<typeof softAuthenticator>>,
  origin = appOrigin,
  rpId = 'localhost',
) {
  const options = await (await call(harness, 'POST', '/auth/login/options')).json();
  const response = await authenticator.login(options.challenge, origin, rpId);
  return call(harness, 'POST', '/auth/login', { body: { response } });
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

it('등록은 1회 코드가 맞고 자격이 0개일 때만 되며, 등록 뒤에는 같은 코드도 거절한다', async () => {
  const harness = workerHarness();
  const key = await softAuthenticator();
  const wrong = await call(harness, 'POST', '/auth/register/options', { body: { code: 'wrong' } });
  expect(wrong.status).toBe(403);
  expect((await (await call(harness, 'GET', '/auth/state')).json()).registered).toBe(false);
  const registered = await register(harness, key);
  expect(registered.status).toBe(200);
  const { token, expiresAt } = await registered.json();
  expect(Date.parse(expiresAt) - harness.clock.now).toBe(aiV2JobLimits.tokenLifetimeMs);
  expect((await call(harness, 'GET', '/api/ai/v2/status', { headers: bearer(token) })).status).toBe(200);
  const again = await register(harness, await softAuthenticator());
  expect(again.status).toBe(409);
  // 자격 행이 지워져도 등록 코드는 다시 쓸 수 없다.
  harness.sql.exec('DELETE FROM credentials');
  const reopened = await call(harness, 'POST', '/auth/register/options', {
    body: { code: testVars.REGISTRATION_CODE },
  });
  expect(reopened.status).toBe(409);
});

it('로그인은 origin·rpId를 고정 비교한다', async () => {
  const harness = workerHarness();
  const key = await softAuthenticator();
  await register(harness, key);
  expect((await login(harness, key, 'http://localhost:5999')).status).toBe(401);
  expect((await login(harness, key, appOrigin, 'evil.example')).status).toBe(401);
  const ok = await login(harness, key);
  expect(ok.status).toBe(200);
  expect((await ok.json()).token).toMatch(/^[\w-]+\.[\w-]+$/);
});

it('챌린지는 한 번만 쓰인다: 같은 응답을 다시 보내면 거절한다', async () => {
  const harness = workerHarness();
  const key = await softAuthenticator();
  await register(harness, key);
  const options = await (await call(harness, 'POST', '/auth/login/options')).json();
  const response = await key.login(options.challenge, appOrigin);
  expect((await call(harness, 'POST', '/auth/login', { body: { response } })).status).toBe(200);
  expect((await call(harness, 'POST', '/auth/login', { body: { response } })).status).toBe(401);
});

it('토큰은 1시간 뒤 token_expired, 해지 뒤 401, 서명 키 교체 뒤 401', async () => {
  const harness = workerHarness();
  const key = await softAuthenticator();
  const { token } = await (await register(harness, key)).json();
  harness.clock.now += aiV2JobLimits.tokenLifetimeMs;
  const expired = await call(harness, 'GET', '/api/ai/v2/status', { headers: bearer(token) });
  expect(expired.status).toBe(401);
  expect((await expired.json()).code).toBe('token_expired');
  const fresh = (await (await login(harness, key)).json()).token as string;
  expect((await call(harness, 'POST', '/auth/revoke', { headers: bearer(fresh) })).status).toBe(200);
  expect((await call(harness, 'GET', '/api/ai/v2/status', { headers: bearer(fresh) })).status).toBe(401);
  const other = (await (await login(harness, key)).json()).token as string;
  const rotated = createApp(
    { ...testVars, TOKEN_SECRET: 'rotated-secret-abcdefghijklmnopqrstuvwxyz' },
    { sql: harness.sql, now: () => harness.clock.now, schedule: () => undefined },
  );
  const response = await handleRequest(
    new Request('http://worker.test/api/ai/v2/status', { headers: { Origin: appOrigin, ...bearer(other) } }),
    rotated,
  );
  expect(response.status).toBe(401);
});

it('v2 경로는 status를 포함해 전부 Bearer가 필요하다', async () => {
  const harness = workerHarness();
  const id = crypto.randomUUID();
  const responses = await Promise.all([
    call(harness, 'GET', '/api/ai/v2/status'),
    call(harness, 'POST', '/api/ai/v2/jobs'),
    call(harness, 'GET', `/api/ai/v2/jobs/${id}`),
    call(harness, 'POST', `/api/ai/v2/jobs/${id}/cancel`),
    call(harness, 'GET', '/api/ai/v2/status', { headers: { Authorization: 'Bearer forged.token' } }),
  ]);
  expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401]);
});

it('허용 목록 밖 Origin은 403, 허용 origin만 CORS를 받고 자격증명 헤더는 없다', async () => {
  const harness = workerHarness();
  const evil = await call(harness, 'GET', '/auth/state', { headers: { Origin: 'https://evil.example' } });
  expect(evil.status).toBe(403);
  expect(evil.headers.get('Access-Control-Allow-Origin')).toBeNull();
  const preflight = await call(harness, 'OPTIONS', '/api/ai/v2/jobs', {
    headers: { Origin: 'https://jeongjae.github.io' },
  });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('https://jeongjae.github.io');
  expect(preflight.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
  expect(preflight.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  const evilPreflight = await call(harness, 'OPTIONS', '/api/ai/v2/jobs', { headers: { Origin: 'null' } });
  expect(evilPreflight.status).toBe(403);
});

it('본문 512 KiB 초과는 413(Content-Length 없이 흘려 보내도), JSON 아니면 415', async () => {
  const harness = workerHarness();
  const big = 'x'.repeat(aiV2JobLimits.maxBodyBytes + 1);
  const declared = await handleRequest(
    new Request('http://worker.test/api/ai/v2/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(big.length) },
      body: big,
    }),
    harness.app,
  );
  expect(declared.status).toBe(413);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(big));
      controller.close();
    },
  });
  const streamed = await handleRequest(
    new Request('http://worker.test/api/ai/v2/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit),
    harness.app,
  );
  expect(streamed.status).toBe(413);
  const text = await call(harness, 'POST', '/auth/login/options', { headers: { 'Content-Type': 'text/plain' } });
  expect(text.status).toBe(415);
});

it('v1 경로는 Worker에 없고, 초기화 경로는 로컬 시험 설정에서만 열린다', async () => {
  const harness = workerHarness();
  expect((await call(harness, 'POST', '/api/ai/jobs')).status).toBe(404);
  expect((await call(harness, 'POST', '/__test/reset')).status).toBe(404);
  expect((await call(harness, 'POST', '/__test/clock', { body: { advanceMs: 1 } })).status).toBe(404);
  const production = createApp(
    { ...testVars, RP_ID: 'jeongjae.github.io', E2E_RESET: '1' },
    { sql: harness.sql, now: () => harness.clock.now, schedule: () => undefined },
  );
  expect(production.allowReset).toBe(false);
  const local = createApp(
    { ...testVars, E2E_RESET: '1' },
    {
      sql: harness.sql,
      now: () => harness.clock.now,
      schedule: () => undefined,
    },
  );
  expect(local.allowReset).toBe(true);
});
