// Worker HTTP 라우터. Origin·CORS·본문 상한·인증을 여기서 끝내고 작업·인증 모듈에 넘긴다.
import { aiV2JobLimits } from '../../src/ai-v2-contract.ts';
import { AiV2RequestError } from '../../src/ai-v2-jobs-core.ts';
import type { Auth } from './auth.ts';
import type { WorkerJobs } from './jobs.ts';
import type { AiStore } from './store.ts';

export type AppContext = {
  store: AiStore;
  auth: Auth;
  jobs: WorkerJobs;
  /** CORS·Origin 허용 목록. WebAuthn origin 비교와 같은 값이다. */
  origins: string[];
  /** 로컬 E2E에서만 켠다. 모든 표를 비운다. */
  allowReset: boolean;
  onReset?: () => void;
  /** 로컬 E2E에서 DO 재시작을 재현한다: 메모리만 비우고 저장소는 유지한다. */
  onRestart?: () => void;
  /** 로컬 E2E에서 토큰 만료·24시간 보관을 재현하려고 시계를 앞으로 민다. */
  advanceClock?: (ms: number) => void;
};

const jobPath = /^\/api\/ai\/v2\/jobs\/([a-f0-9-]{36})(\/cancel|\/ack)?$/;

/** 본문을 끝까지 받기 전에 상한을 넘으면 멈춘다. Content-Length가 없어도 센다. */
async function readJson(request: Request) {
  const limit = aiV2JobLimits.maxBodyBytes;
  const tooLarge = () =>
    new AiV2RequestError(413, 'body_too_large', `AI 요청은 ${Math.round(limit / 1024)} KiB 이하로 줄여 주세요.`);
  if (Number(request.headers.get('Content-Length') ?? 0) > limit) {
    throw tooLarge();
  }
  if (!request.body) {
    return {};
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  return text.trim() ? (JSON.parse(text) as unknown) : {};
}

function corsHeaders(origin: string | null, allowed: boolean): Record<string, string> {
  if (!origin || !allowed) {
    return { Vary: 'Origin' };
  }
  // 자격증명(쿠키) 헤더는 보내지 않는다. 인증은 Authorization 헤더뿐이다.
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Travel-App',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

export async function handleRequest(request: Request, app: AppContext): Promise<Response> {
  const origin = request.headers.get('Origin');
  const allowed = origin !== null && app.origins.includes(origin);
  const cors = corsHeaders(origin, allowed);
  const reply = (status: number, value: unknown) =>
    new Response(JSON.stringify(value), {
      status,
      headers: {
        ...cors,
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  // 브라우저는 교차 출처 요청에 Origin을 붙인다. 허용 목록 밖이면 인증 전에 거절한다.
  if (origin !== null && !allowed) {
    return reply(403, { error: '허용하지 않는 출처입니다.', code: 'origin_forbidden' });
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  const path = new URL(request.url).pathname;
  try {
    let body: Record<string, unknown> = {};
    if (request.method === 'POST') {
      if (!request.headers.get('Content-Type')?.startsWith('application/json')) {
        return reply(415, { error: 'JSON 요청만 허용합니다.', code: 'unsupported_media_type' });
      }
      body = (await readJson(request)) as Record<string, unknown>;
    }
    if (path.startsWith('/auth/')) {
      return reply(200, await routeAuth(request, path, body, app));
    }
    if (path === '/__test/reset' && request.method === 'POST' && app.allowReset) {
      app.store.resetAll();
      app.onReset?.();
      return reply(200, { reset: true });
    }
    if (path === '/__test/restart' && request.method === 'POST' && app.allowReset) {
      app.onRestart?.();
      return reply(200, { restarted: true });
    }
    // 끝난 작업의 실행 중 원문이 남지 않았는지 E2E가 행 수만 본다(내용은 내보내지 않는다).
    if (path === '/__test/inflight' && request.method === 'GET' && app.allowReset) {
      return reply(200, { count: app.store.countInflight() });
    }
    if (path === '/__test/clock' && request.method === 'POST' && app.allowReset) {
      app.advanceClock?.(Math.max(0, Number(body.advanceMs) || 0));
      return reply(200, { advanced: true });
    }
    if (path.startsWith('/api/ai/v2/')) {
      // status를 포함한 v2 경로 전부가 인증을 요구한다.
      await app.auth.verify(request.headers.get('Authorization'));
      if (request.method === 'GET' && path === '/api/ai/v2/status') {
        return reply(200, app.jobs.status());
      }
      if (request.method === 'POST' && path === '/api/ai/v2/jobs') {
        return reply(202, await app.jobs.create(body));
      }
      if (request.method === 'GET' && path === '/api/ai/v2/jobs') {
        return reply(200, app.jobs.list(new URL(request.url).searchParams.get('tripId')));
      }
      const match = jobPath.exec(path);
      if (match && request.method === 'GET' && !match[2]) {
        const job = app.jobs.get(match[1]);
        return job ? reply(200, job) : reply(404, { error: 'AI 작업이 없습니다.', code: 'not_found' });
      }
      if (match && request.method === 'POST' && match[2] === '/cancel') {
        return reply(200, await app.jobs.cancel(match[1]));
      }
      if (match && request.method === 'POST' && match[2] === '/ack') {
        return reply(200, app.jobs.acknowledge(match[1]));
      }
      return reply(404, { error: '없는 v2 API 경로입니다.', code: 'not_found' });
    }
    // v1(`/api/ai/jobs`)은 Worker로 옮기지 않았다(G13).
    return reply(404, { error: '없는 API 경로입니다.', code: 'not_found' });
  } catch (error) {
    if (error instanceof AiV2RequestError) {
      return reply(error.status, { error: error.message, code: error.code });
    }
    // 스키마·JSON 오류는 입력을 담을 수 있으므로 문구를 드러내지 않는다.
    if (error instanceof Error && (error.name === 'ZodError' || error.name === 'SyntaxError')) {
      return reply(400, { error: 'AI 요청 형식이 올바르지 않습니다.', code: 'invalid_request' });
    }
    return reply(500, { error: 'Worker 내부 오류입니다.', code: 'internal' });
  }
}

async function routeAuth(request: Request, path: string, body: Record<string, unknown>, app: AppContext) {
  if (request.method === 'GET' && path === '/auth/state') {
    // 잠금 여부만 알린다. 코드·실패 횟수는 내보내지 않는다.
    await app.auth.syncCodeFingerprint();
    return { registered: app.auth.registered(), locked: app.auth.locked() };
  }
  // 패스키 관리는 로그인한 상태에서만(Bearer 필수, 등록 코드 불필요).
  if (path === '/auth/credentials' || path.startsWith('/auth/credentials/')) {
    await app.auth.verify(request.headers.get('Authorization'));
    if (request.method === 'GET' && path === '/auth/credentials') {
      return app.auth.listCredentials();
    }
    if (request.method === 'POST' && path === '/auth/credentials/options') {
      return app.auth.addCredentialOptions();
    }
    if (request.method === 'POST' && path === '/auth/credentials') {
      return app.auth.addCredential(body);
    }
    if (request.method === 'POST' && path === '/auth/credentials/delete') {
      return app.auth.deleteCredential(body);
    }
    throw new AiV2RequestError(404, 'not_found', '없는 인증 경로입니다.');
  }
  if (request.method !== 'POST') {
    throw new AiV2RequestError(404, 'not_found', '없는 인증 경로입니다.');
  }
  if (path === '/auth/register/options') {
    return app.auth.registrationOptions(body);
  }
  if (path === '/auth/register') {
    return app.auth.register(body);
  }
  if (path === '/auth/login/options') {
    return app.auth.loginOptions();
  }
  if (path === '/auth/login') {
    return app.auth.login(body);
  }
  if (path === '/auth/revoke') {
    app.auth.revoke(await app.auth.verify(request.headers.get('Authorization')));
    return { revoked: true };
  }
  throw new AiV2RequestError(404, 'not_found', '없는 인증 경로입니다.');
}
