// T-D4 C1: Pages(다른 origin) → Worker 교차 출처 호출 확인. 가상 패스키·로컬 Worker만 쓰며 외부 호출은 없다.
// VITE_AI_API_BASE를 넣어 따로 빌드한 폴더가 있을 때만 돈다(E2E_CROSS_ORIGIN_DIST). 보통 실행에서는 건너뛴다.
import { expect, test, type Request } from '@playwright/test';
import { aiV2Fixture } from '../fixtures/ai-v2';
import { openMore } from './helpers/nav';
import { importTrip } from './helpers/trip';
import { addVirtualAuthenticator, e2eWorker, registerPasskeyInApp, resetBackends } from './helpers/worker';

test.skip(!process.env.E2E_CROSS_ORIGIN_DIST, 'E2E_CROSS_ORIGIN_DIST가 있을 때만 실행');
test.use({ baseURL: e2eWorker.appOrigin });

test('교차 출처: 모든 AI 요청이 Worker origin으로 가고, 인증은 Authorization 헤더뿐이며 쿠키가 없다', async ({
  page,
}) => {
  await resetBackends();
  await addVirtualAuthenticator(page);
  const aiRequests: Request[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/') || path.startsWith('/auth/')) {
      aiRequests.push(request);
    }
  });
  await importTrip(page, await aiV2Fixture());
  await openMore(page, '변경안');
  await registerPasskeyInApp(page);
  await page.getByRole('button', { name: '로그아웃' }).click();
  await page.getByRole('button', { name: '패스키로 로그인' }).click();
  await expect(page.getByText('패스키 로그인됨', { exact: false })).toBeVisible();
  // 로그인 뒤 상태 조회가 한 번은 나가도록 잠시 기다린다.
  await expect.poll(() => aiRequests.some((request) => request.url().includes('/api/ai/v2/status'))).toBe(true);

  expect(aiRequests.length).toBeGreaterThan(0);
  for (const request of aiRequests) {
    const url = new URL(request.url());
    expect(url.origin, request.url()).toBe(e2eWorker.origin);
    const headers = await request.allHeaders();
    expect(headers.cookie, `${request.method()} ${url.pathname} 쿠키`).toBeUndefined();
  }
  const authorized = aiRequests.filter((request) => request.url().includes('/api/ai/v2/'));
  expect(authorized.length).toBeGreaterThan(0);
  for (const request of authorized) {
    expect((await request.allHeaders()).authorization, request.url()).toMatch(/^Bearer .+/);
  }
  expect(await page.evaluate(() => document.cookie)).toBe('');
  const cookies = await page.context().cookies();
  expect(cookies.filter((cookie) => /127\.0\.0\.1|localhost/.test(cookie.domain))).toEqual([]);
});
