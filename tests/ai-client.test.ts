// T-D2 §E: 앱 폴링 백오프·재로그인 판단과 Worker 상태 라벨.
import { afterEach, expect, it, vi } from 'vitest';
import {
  AiApiError,
  aiFetch,
  apiErrorDetail,
  nextPollStep,
  pollRetryDelay,
  pollRetryLimit,
  saveToken,
  tokenExpired,
} from '../src/content/ai-client';
import { jobStatusLabel } from '../src/content/ai-job-label';
import { outputExpiredMessage } from '../src/ai-v2-contract';

afterEach(() => {
  vi.unstubAllGlobals();
  saveToken(null);
});

it('연결 오류·5xx는 1·2·4·8·16초로 5회 다시 묻고 그다음은 연결 끊김', () => {
  const network = new AiApiError(0, 'network', 'x');
  const delays = [];
  for (let failures = 0; failures < pollRetryLimit; failures++) {
    const step = nextPollStep(network, failures);
    expect(step.action).toBe('retry');
    delays.push(step.action === 'retry' ? step.delay : 0);
  }
  expect(delays).toEqual([1000, 2000, 4000, 8000, 16000]);
  expect(nextPollStep(new AiApiError(502, '', 'x'), pollRetryLimit)).toEqual({ action: 'lost' });
  expect(pollRetryDelay(10)).toBe(30_000);
});

it('401은 재로그인, 4xx는 실패로 넘긴다', () => {
  expect(nextPollStep(new AiApiError(401, 'token_expired', 'x'), 0)).toEqual({ action: 'login' });
  expect(nextPollStep(new AiApiError(404, 'not_found', 'x'), 0)).toEqual({ action: 'fail' });
});

it('요청에 Bearer 토큰을 붙이고 오류 코드를 보존한다', async () => {
  saveToken({ token: 'abc.def', expiresAt: '2999-01-01T00:00:00Z' });
  const fetch = vi.fn(
    async () => new Response(JSON.stringify({ error: '한도', code: 'daily_limit' }), { status: 429 }),
  );
  vi.stubGlobal('fetch', fetch);
  const error = await aiFetch('/api/ai/v2/jobs', {}).catch((exception: unknown) => exception);
  expect(error).toBeInstanceOf(AiApiError);
  expect((error as AiApiError).code).toBe('daily_limit');
  const init = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect((init[1].headers as Record<string, string>).Authorization).toBe('Bearer abc.def');
  expect(tokenExpired({ token: 'a.b', expiresAt: '2000-01-01T00:00:00Z' })).toBe(true);
});

it('expired·unknown 상태 라벨, Node 경로의 만료 문구도 만료로 보인다', () => {
  expect(jobStatusLabel('expired', {})).toBe('만료');
  expect(jobStatusLabel('unknown', {})).toBe('결과 불명 — 다시 요청');
  expect(jobStatusLabel('failed', { failed: '실패' }, outputExpiredMessage)).toBe('만료');
});

it('T-D5 C1 D: 오류 상세는 HTTP 코드와 서버 오류 코드만 보인다', () => {
  expect(apiErrorDetail(new AiApiError(429, 'daily_limit', '오늘 한도'))).toBe('HTTP 429 · daily_limit');
  expect(apiErrorDetail(new AiApiError(0, 'network', '연결 실패'))).toBe('연결 실패 · network');
  expect(apiErrorDetail(new AiApiError(500, '', '내부'))).toBe('HTTP 500');
  expect(apiErrorDetail(new Error('일반 오류'))).toBe('');
});
