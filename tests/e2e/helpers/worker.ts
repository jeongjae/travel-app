// E2E가 쓰는 로컬 Worker(wrangler dev)와 가짜 OpenAI. 모두 가상 값이며 외부 서비스에 닿지 않는다.
import { expect, type Page } from '@playwright/test';

export const e2eWorker = {
  origin: 'http://127.0.0.1:8787',
  fakeOpenAi: 'http://127.0.0.1:8799',
  /** WebAuthn RP ID가 localhost이므로 앱은 localhost로 연다. */
  appOrigin: 'http://localhost:4173',
  registrationCode: 'e2e-registration-code',
  model: 'fictional-provider-no-api',
};

async function post(url: string, body: unknown = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(response.ok, `${url} → ${response.status}`).toBe(true);
  return response.json();
}

/** Worker 표와 가짜 OpenAI 설정을 비운다. 시험마다 첫 패스키 등록부터 시작한다. */
export async function resetBackends() {
  await post(`${e2eWorker.origin}/__test/reset`);
  await post(`${e2eWorker.fakeOpenAi}/__control/reset`);
}

export async function configureFakeOpenAi(config: Record<string, unknown>) {
  await post(`${e2eWorker.fakeOpenAi}/__control/config`, config);
}

export async function fakeOpenAiRequests(): Promise<
  { method: string; path: string; body?: Record<string, unknown> }[]
> {
  return (await fetch(`${e2eWorker.fakeOpenAi}/__control/requests`)).json();
}

export async function advanceWorkerClock(advanceMs: number) {
  await post(`${e2eWorker.origin}/__test/clock`, { advanceMs });
}

/** Worker를 DO 재시작처럼 만든다: 메모리만 비우고 저장소(inflight 포함)·alarm은 그대로 둔다. */
export async function restartWorker() {
  await post(`${e2eWorker.origin}/__test/restart`);
}

/** 실행 중 원문 행 수. 끝난 작업만 있으면 0이어야 한다. */
export async function inflightCount(): Promise<number> {
  const response = await fetch(`${e2eWorker.origin}/__test/inflight`);
  return ((await response.json()) as { count: number }).count;
}

/** 페이지의 로그인 토큰으로 작업을 직접 조회한다(화면이 아닌 서버 상태 확인용). */
export async function workerJob(page: Page, id: string) {
  return page.evaluate(async (jobId) => {
    const stored = sessionStorage.getItem('travel-app-ai-token');
    const token = stored ? (JSON.parse(stored) as { token: string }).token : '';
    const response = await fetch(`/api/ai/v2/jobs/${jobId}`, { headers: { Authorization: `Bearer ${token}` } });
    return (await response.json()) as { id: string; status: string; result?: unknown; usage?: unknown };
  }, id);
}

export type VirtualAuthenticator = Awaited<ReturnType<typeof addVirtualAuthenticator>>;

/** 브라우저를 닫고 다시 연 것처럼 새 탭의 가상 인증기에 기존 패스키를 옮긴다. */
export async function copyPasskeys(from: VirtualAuthenticator, to: VirtualAuthenticator) {
  const { credentials } = await from.client.send('WebAuthn.getCredentials', { authenticatorId: from.authenticatorId });
  for (const credential of credentials) {
    await to.client.send('WebAuthn.addCredential', { authenticatorId: to.authenticatorId, credential });
  }
}

/**
 * Chromium CDP 가상 인증기. 사용자 확인(UV)까지 자동으로 통과한다.
 * `usb`는 다른 기기(cross-platform) 역할이다. 패스키 추가는 서버가 cross-platform을 요구한다(휴대폰 QR 경로).
 */
export async function addVirtualAuthenticator(page: Page, transport: 'internal' | 'usb' = 'internal') {
  const client = await page.context().newCDPSession(page);
  await client.send('WebAuthn.enable');
  const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport,
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { client, authenticatorId };
}

export async function registerPasskeyInApp(page: Page) {
  await page.getByLabel('1회 등록 코드').fill(e2eWorker.registrationCode);
  await page.getByRole('button', { name: '패스키 등록', exact: true }).click();
  await expect(page.getByText('패스키 로그인됨', { exact: false })).toBeVisible();
}
