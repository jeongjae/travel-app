// T-D2 전체 흐름: 로컬 Worker(wrangler dev) + 가짜 OpenAI + 가상 패스키.
// 등록 → 로그아웃·로그인 → 미리보기·동의 → 전송 → background 폴링 → 변경안 거절 → 토큰 만료 후 재로그인
// → 잔여 횟수 감소 → 결과 불명(unknown) → 24시간 뒤 만료(expired). 실제 OpenAI·Cloudflare 호출은 없다.
import { expect, test, type Page } from '@playwright/test';
import { buildPackage } from '../../src/transfer/package';
import { digestBytes } from '../../src/contracts/v2';
import { fixtureAssets } from '../fixtures/pilot';
import { aiV2Fixture } from '../fixtures/ai-v2';
import { openMore } from './helpers/nav';
import {
  addVirtualAuthenticator,
  advanceWorkerClock,
  configureFakeOpenAi,
  e2eWorker,
  fakeOpenAiRequests,
  registerPasskeyInApp,
  resetBackends,
} from './helpers/worker';

test.use({ baseURL: e2eWorker.appOrigin });
test.setTimeout(90_000);

const shotsDirectory = process.env.UI_D02_SHOTS;
async function shot(page: Page, name: string, target?: ReturnType<Page['locator']>) {
  if (!shotsDirectory) {
    return;
  }
  await (target ?? page.locator('h3', { hasText: 'AI 조사·변경안' })).evaluate((element) =>
    element.scrollIntoView({ block: 'center' }),
  );
  await page.screenshot({ path: `${shotsDirectory}/${test.info().project.name}-${name}.png`, fullPage: false });
}

async function sendRequest(page: Page, prompt: string) {
  await page.getByRole('textbox', { name: '변경 요청', exact: true }).fill(prompt);
  await page.getByRole('button', { name: '전송할 내용 미리보기', exact: true }).click();
  await page.getByLabel('위 내용 전송과 OpenAI API 유료 실행에 동의', { exact: false }).check();
  await page.getByRole('button', { name: '조사하고 초안 만들기', exact: true }).click();
}

test('T-D2 Worker 경로: 패스키·잔여 횟수·사용량·토큰 만료·불명·만료', async ({ page }) => {
  const fixture = await aiV2Fixture();
  await resetBackends();
  await configureFakeOpenAi({ outputs: [fixture.output], pollsBeforeDone: 0, sources: fixture.research.sources });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    // 만료 토큰으로 부른 요청의 401은 의도한 흐름이다. 그 밖의 콘솔 오류는 실패로 본다.
    if (message.type() === 'error' && !/status of 401/.test(message.text())) {
      errors.push(message.text());
    }
  });
  await addVirtualAuthenticator(page);
  await page.goto('/?workspace=content');
  const assets = new Map<string, Uint8Array>();
  for (const bytes of Object.values(fixtureAssets)) {
    assets.set(await digestBytes(bytes), bytes);
  }
  const packaged = await buildPackage(fixture.dataset, assets, {
    sourceRepository: 'synthetic/ai-v2',
    sourceCommit: 'fictional-only',
    lineageId: 'synthetic-ai-d02',
    adapterVersion: '1',
    normalizationVersion: '2',
  });
  await page.getByLabel('원천 패키지 가져오기').setInputFiles({
    name: 'fictional-ai-d02.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(await packaged.blob.arrayBuffer()),
  });
  await page.getByRole('button', { name: '여행에 추가', exact: true }).click();
  await openMore(page, '변경안');

  // 1. 등록 전: 미리보기는 되지만 동의·전송은 막힌다.
  await expect(page.getByLabel('1회 등록 코드')).toBeVisible();
  await page.getByLabel('변경 요청', { exact: true }).fill('로그인 전 미리보기');
  await page.getByRole('button', { name: '전송할 내용 미리보기', exact: true }).click();
  await expect(page.getByText('로그인한 뒤에 동의하고 전송할 수 있습니다.')).toBeVisible();
  await expect(page.getByRole('button', { name: '조사하고 초안 만들기', exact: true })).toBeDisabled();
  await shot(page, 'register');
  await registerPasskeyInApp(page);
  await expect(page.getByLabel('오늘 AI 사용량')).toContainText('오늘 남은 요청 20/20');

  // 2. 로그아웃 → 패스키 로그인.
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page.getByRole('button', { name: '패스키로 로그인', exact: true })).toBeVisible();
  await shot(page, 'login');
  await page.getByRole('button', { name: '패스키로 로그인', exact: true }).click();
  await expect(page.getByText('패스키 로그인됨', { exact: false })).toBeVisible();

  // 3. 전송 → background 폴링 → 변경안 저장, 잔여 감소·사용량 표시.
  await sendRequest(page, '가상 일정 조정 요청');
  await expect(page.getByLabel('오늘 AI 사용량')).toContainText('오늘 남은 요청 19/20');
  await expect(page.getByText('변경안에 저장됨', { exact: false })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('이 작업 사용량: 토큰 300', { exact: false })).toBeVisible();
  await expect(page.getByLabel('오늘 AI 사용량')).toContainText('오늘 사용 토큰 300');
  await shot(page, 'usage', page.getByRole('status').filter({ hasText: '변경안에 저장됨' }));

  // 4. 변경안 거절.
  const proposal = page
    .locator('article.content-row')
    .filter({ has: page.getByRole('heading', { name: fixture.output.reason }) });
  await proposal.getByRole('button', { name: '변경안 거절', exact: true }).click();
  await expect(proposal.getByText('거절됨', { exact: false })).toBeVisible();

  // 5. 1시간 뒤: 서버가 token_expired로 거절 → 재로그인 안내 → 다시 로그인.
  await advanceWorkerClock(61 * 60 * 1000);
  await page.reload();
  await openMore(page, '변경안');
  await expect(page.getByText('토큰 만료 — 다시 로그인하세요.')).toBeVisible();
  await shot(page, 'token-expired');
  await page.getByRole('button', { name: '패스키로 다시 로그인', exact: true }).click();
  await expect(page.getByText('패스키 로그인됨', { exact: false })).toBeVisible();

  // 6. 생성 호출 중 연결이 끊기면 결과 불명. 자동 재호출은 없다.
  await configureFakeOpenAi({ dropCreate: true });
  await sendRequest(page, '연결이 끊기는 가상 요청');
  await expect(page.getByText('결과 불명 — 다시 요청', { exact: false })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel('오늘 AI 사용량')).toContainText('오늘 남은 요청 18/20');
  await shot(page, 'unknown', page.getByRole('status').filter({ hasText: '결과 불명' }));
  const creates = (await fakeOpenAiRequests()).filter(
    (request) => request.method === 'POST' && request.path === '/v1/responses',
  );
  expect(creates).toHaveLength(3);

  // 7. 24시간 뒤: 출력이 지워지고 만료로 보인다(다시 로그인 필요).
  await advanceWorkerClock(25 * 60 * 60 * 1000);
  await page.reload();
  await openMore(page, '변경안');
  await page.getByRole('button', { name: '패스키로 다시 로그인', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '만료' })).toBeVisible();
  await shot(page, 'expired', page.getByRole('status').filter({ hasText: '만료' }));

  // 가짜 OpenAI가 받은 본문: 전부 background, 예약·현장 메모 표식 없음.
  const bodies = (await fakeOpenAiRequests())
    .filter((request) => request.method === 'POST' && request.path === '/v1/responses' && request.body)
    .map((request) => request.body!);
  expect(bodies.every((body) => body.background === true && body.store === false)).toBe(true);
  expect(JSON.stringify(bodies)).not.toContain('SYNTHETIC-PRIVATE');
  expect(errors).toEqual([]);
  expect(await page.locator('body').evaluate((body) => body.scrollWidth <= innerWidth)).toBe(true);
});
