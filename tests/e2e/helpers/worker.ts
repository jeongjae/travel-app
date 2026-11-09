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

/** Chromium CDP 가상 인증기. 사용자 확인(UV)까지 자동으로 통과한다. */
export async function addVirtualAuthenticator(page: Page) {
  const client = await page.context().newCDPSession(page);
  await client.send('WebAuthn.enable');
  await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

export async function registerPasskeyInApp(page: Page) {
  await page.getByLabel('1회 등록 코드').fill(e2eWorker.registrationCode);
  await page.getByRole('button', { name: '패스키 등록', exact: true }).click();
  await expect(page.getByText('패스키 로그인됨', { exact: false })).toBeVisible();
}
