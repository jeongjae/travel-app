// T-D5 C1: 로그인한 상태의 두 번째 패스키(가상 인증기 2개), AI 작업 기록(CL-38), 오류 상세(HTTP·코드).
// 로컬 Worker(wrangler dev) + 가짜 OpenAI. 실제 OpenAI·Cloudflare 호출은 없다.
import { expect, test, type Page } from '@playwright/test';
import { buildPackage } from '../../src/transfer/package';
import { digestBytes } from '../../src/contracts/v2';
import { fixtureAssets } from '../fixtures/pilot';
import { aiV2Fixture } from '../fixtures/ai-v2';
import { openMore } from './helpers/nav';
import {
  addVirtualAuthenticator,
  configureFakeOpenAi,
  e2eWorker,
  registerPasskeyInApp,
  resetBackends,
  type VirtualAuthenticator,
} from './helpers/worker';

test.use({ baseURL: e2eWorker.appOrigin });
test.setTimeout(90_000);

async function removeAuthenticator(authenticator: VirtualAuthenticator) {
  await authenticator.client.send('WebAuthn.removeVirtualAuthenticator', {
    authenticatorId: authenticator.authenticatorId,
  });
}

async function credentialCount(authenticator: VirtualAuthenticator) {
  const { credentials } = await authenticator.client.send('WebAuthn.getCredentials', {
    authenticatorId: authenticator.authenticatorId,
  });
  return credentials.length;
}

/** 페이지 토큰으로 작업 목록 API를 직접 부른다(canary: 응답에 내용이 없는지). */
async function jobListText(page: Page, tripId: string) {
  return page.evaluate(async (id) => {
    const stored = sessionStorage.getItem('travel-app-ai-token');
    const token = stored ? (JSON.parse(stored) as { token: string }).token : '';
    const response = await fetch(`/api/ai/v2/jobs?tripId=${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return `${response.status} ${await response.text()}`;
  }, tripId);
}

test('T-D5 C1: 두 번째 패스키 추가·로그인·삭제 제한, AI 작업 기록, 오류 상세', async ({ page }) => {
  const fixture = await aiV2Fixture();
  await resetBackends();
  await configureFakeOpenAi({ outputs: [fixture.output], pollsBeforeDone: 0, sources: fixture.research.sources });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    // 의도한 거절(409·429)의 리소스 오류 줄은 제외한다.
    if (message.type() === 'error' && !/status of (401|409|429)/.test(message.text())) {
      errors.push(message.text());
    }
  });
  const pc = await addVirtualAuthenticator(page);
  await page.goto('/?workspace=content');
  const assets = new Map<string, Uint8Array>();
  for (const bytes of Object.values(fixtureAssets)) {
    assets.set(await digestBytes(bytes), bytes);
  }
  const packaged = await buildPackage(fixture.dataset, assets, {
    sourceRepository: 'synthetic/ai-v2',
    sourceCommit: 'fictional-only',
    lineageId: 'synthetic-ai-d05',
    adapterVersion: '1',
    normalizationVersion: '2',
  });
  await page.getByLabel('원천 패키지 가져오기').setInputFiles({
    name: 'fictional-ai-d05.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(await packaged.blob.arrayBuffer()),
  });
  await page.getByRole('button', { name: '여행에 추가', exact: true }).click();
  await openMore(page, '변경안');
  await registerPasskeyInApp(page);

  // 1. 패스키 관리: 1개뿐이면 삭제할 수 없다.
  await page.getByText('패스키 관리 (1/3)').click();
  const list = page.getByRole('list', { name: '등록된 패스키' });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list.getByRole('button', { name: '삭제', exact: true })).toBeDisabled();

  // 2. 두 번째 패스키(휴대폰 역할의 가상 인증기)를 로그인한 상태에서 추가한다. 등록 코드는 묻지 않는다.
  await removeAuthenticator(pc);
  const phone = await addVirtualAuthenticator(page, 'usb');
  await page.getByRole('textbox', { name: '라벨', exact: true }).fill('가상 휴대폰');
  await page.getByRole('button', { name: '패스키 추가', exact: true }).click();
  await expect(page.getByText('패스키 관리 (2/3)')).toBeVisible();
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list).toContainText('가상 휴대폰');
  expect(await credentialCount(phone)).toBe(1);

  // 3. 휴대폰 패스키만 있는 상태에서 로그아웃 → 로그인. 마지막 사용 시각이 생긴다.
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await page.getByRole('button', { name: '패스키로 로그인', exact: true }).click();
  await expect(page.getByText('패스키 로그인됨', { exact: false })).toBeVisible();
  await page.getByText('패스키 관리 (2/3)').click();
  await expect(list.getByRole('listitem').filter({ hasText: '가상 휴대폰' })).not.toContainText('마지막 사용 없음');

  // 4. 작업 1건 → AI 작업 기록에 상태·토큰만 보이고, 목록 API에 요청·결과 내용이 없다.
  await page.getByRole('textbox', { name: '변경 요청', exact: true }).fill('CANARY-D05-PROMPT 가상 요청');
  await page.getByRole('button', { name: '전송할 내용 미리보기', exact: true }).click();
  await page.getByLabel('위 내용 전송과 OpenAI API 유료 실행에 동의', { exact: false }).check();
  await page.getByRole('button', { name: '조사하고 초안 만들기', exact: true }).click();
  await expect(page.getByText('변경안에 저장됨', { exact: false })).toBeVisible({ timeout: 20_000 });
  await page.getByText(/^AI 작업 기록/).click();
  const history = page.getByRole('list', { name: 'AI 작업 기록' });
  await expect(history.getByRole('listitem')).toHaveCount(1);
  await expect(history).toContainText('토큰 300');
  await expect(history).toContainText('웹 검색 1');
  const listed = await jobListText(page, fixture.dataset.header.tripId);
  expect(listed.startsWith('200 ')).toBe(true);
  expect(listed).not.toContain('CANARY-D05-PROMPT');
  expect(listed).not.toContain(fixture.output.reason);
  expect(listed).not.toContain('SYNTHETIC-PRIVATE');
  expect(listed).not.toContain('"result"');

  // 5. 일일 한도(429) 같은 서버 거절은 접힌 상세에 HTTP·오류 코드를 보인다.
  await page.getByRole('textbox', { name: '변경 요청', exact: true }).fill('한도 초과 가상 요청');
  await page.getByRole('button', { name: '전송할 내용 미리보기', exact: true }).click();
  await page.getByLabel('위 내용 전송과 OpenAI API 유료 실행에 동의', { exact: false }).check();
  await page.route('**/api/ai/v2/jobs', async (route) => {
    if (route.request().method() !== 'POST') {
      return route.fallback();
    }
    // 서버 한도 응답과 같은 모양(429 daily_limit)을 돌려준다. 오늘 한도를 실제로 다 쓰지 않는다.
    return route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({ error: '오늘 AI 요청 한도(20회)를 모두 썼습니다.', code: 'daily_limit' }),
    });
  });
  await page.getByRole('button', { name: '조사하고 초안 만들기', exact: true }).click();
  await expect(page.getByText('오늘 AI 요청 한도(20회)를 모두 썼습니다.')).toBeVisible();
  await page.getByText('오류 상세', { exact: true }).click();
  await expect(page.getByLabel('오류 코드')).toHaveText('HTTP 429 · daily_limit');
  await page.unroute('**/api/ai/v2/jobs');

  // 6. 패스키 삭제: 휴대폰 패스키를 지우면 1개 남고, 남은 1개는 지울 수 없다.
  const phoneRow = list.getByRole('listitem').filter({ hasText: '가상 휴대폰' });
  await phoneRow.getByRole('button', { name: '삭제', exact: true }).click();
  await phoneRow.getByRole('button', { name: '삭제 확인', exact: true }).click();
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list.getByRole('button', { name: '삭제', exact: true })).toBeDisabled();

  expect(errors).toEqual([]);
  expect(await page.locator('body').evaluate((body) => body.scrollWidth <= innerWidth)).toBe(true);
});
