// T-D3 모의 통합·복구: 로컬 Worker(wrangler dev) + 가짜 OpenAI(고장 주입) + 가상 패스키.
// 응답 유실·브라우저 종료·저장 실패·ACK·stale·취소 경합·결과 불명·회수 실패·두 여행 격리·오프라인·Worker 재시작을 재현한다.
// 실제 OpenAI·Cloudflare 호출은 없다.
import { expect, test, type Page } from '@playwright/test';
import { aiV2Fixture } from '../fixtures/ai-v2';
import { openMore, openTripMenu } from './helpers/nav';
import { importTrip } from './helpers/trip';
import {
  addVirtualAuthenticator,
  advanceWorkerClock,
  configureFakeOpenAi,
  copyPasskeys,
  e2eWorker,
  fakeOpenAiRequests,
  inflightCount,
  registerPasskeyInApp,
  resetBackends,
  restartWorker,
  workerJob,
} from './helpers/worker';

test.use({ baseURL: e2eWorker.appOrigin });
test.setTimeout(90_000);

type Fixture = Awaited<ReturnType<typeof aiV2Fixture>>;

const shotsDirectory = process.env.UI_D03_SHOTS;
async function shot(page: Page, name: string, target: ReturnType<Page['locator']>) {
  if (!shotsDirectory) {
    return;
  }
  await target.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: `${shotsDirectory}/${test.info().project.name}-${name}.png`, fullPage: false });
}

/** 기대한 실패(만료 토큰 401·의도적으로 끊은 요청·오프라인)만 빼고 콘솔 오류를 모은다. */
function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') {
      return;
    }
    if (/status of 401|ERR_FAILED|ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(message.text())) {
      return;
    }
    errors.push(message.text());
  });
  return errors;
}

/** 백엔드 초기화 → 여행 가져오기 → 변경안 화면 → 패스키 등록까지. */
async function setup(page: Page, fakeConfig: Record<string, unknown> = {}) {
  const fixture = await aiV2Fixture();
  await resetBackends();
  await configureFakeOpenAi({
    outputs: [fixture.output],
    pollsBeforeDone: 0,
    sources: fixture.research.sources,
    ...fakeConfig,
  });
  const errors = collectErrors(page);
  const authenticator = await addVirtualAuthenticator(page);
  await importTrip(page, fixture);
  await openMore(page, '변경안');
  await registerPasskeyInApp(page);
  return { fixture, errors, authenticator };
}

async function sendRequest(page: Page, prompt: string) {
  await page.getByRole('textbox', { name: '변경 요청', exact: true }).fill(prompt);
  await page.getByRole('button', { name: '전송할 내용 미리보기', exact: true }).click();
  await page.getByLabel('위 내용 전송과 OpenAI API 유료 실행에 동의', { exact: false }).check();
  await page.getByRole('button', { name: '조사하고 초안 만들기', exact: true }).click();
}

const jobStatus = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });
const saved = (page: Page) => page.getByText('변경안에 저장됨', { exact: false });

/** 이 여행 화면이 기억하는 작업 ID(localStorage). */
async function rememberedJobId(page: Page, tripId: string) {
  return page.evaluate((id) => {
    const key = Object.keys(localStorage).find(
      (candidate) => candidate.startsWith('travel-app-ai-v2:') && candidate.endsWith(`:${id}`),
    );
    return key ? localStorage.getItem(key) : null;
  }, tripId);
}

async function openAiCreates() {
  return (await fakeOpenAiRequests()).filter(
    (request) => request.method === 'POST' && request.path === '/v1/responses',
  );
}
async function openAiCancels() {
  return (await fakeOpenAiRequests()).filter((request) => request.path.endsWith('/cancel'));
}

test('A·B4: Worker가 다시 떠도 inflight에서 이어 저장하고, 저장 확인 뒤 서버 출력과 inflight가 지워진다', async ({
  page,
}) => {
  const { fixture, errors } = await setup(page, { hold: true });
  await sendRequest(page, '재시작 복구 가상 요청');
  await expect(jobStatus(page, '출처 조사')).toBeVisible({ timeout: 20_000 });
  expect(await inflightCount()).toBe(1);
  await restartWorker();
  await configureFakeOpenAi({ hold: false });
  await expect(saved(page)).toBeVisible({ timeout: 20_000 });
  await expect(jobStatus(page, '저장 완료')).toBeVisible();
  const id = (await rememberedJobId(page, fixture.dataset.header.tripId))!;
  // ACK는 화면 표시 뒤 비동기로 도착하므로 서버 상태가 바뀔 때까지 기다린다.
  await expect.poll(async () => (await workerJob(page, id)).status, { timeout: 10_000 }).toBe('acknowledged');
  const job = await workerJob(page, id);
  expect(job.result).toBeUndefined();
  expect(job.usage).toMatchObject({ totalTokens: 300 });
  expect(await inflightCount()).toBe(0);
  expect(await openAiCreates()).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('B1: 전송 응답(202)을 못 받으면 같은 요청 ID로 다시 보내 같은 작업을 받고 횟수는 한 번만 쓴다', async ({
  page,
}) => {
  const { errors } = await setup(page);
  const sentIds: string[] = [];
  let dropped = false;
  await page.route('**/api/ai/v2/jobs', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    sentIds.push((route.request().postDataJSON() as { id: string }).id);
    if (!dropped) {
      // 서버까지는 보내고(작업 생성) 브라우저에는 연결 실패로 보인다.
      dropped = true;
      await route.fetch();
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  await sendRequest(page, '응답 유실 가상 요청');
  await expect(page.getByText('전송 결과를 확인하지 못했습니다', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '조사하고 초안 만들기', exact: true }).click();
  await expect(saved(page)).toBeVisible({ timeout: 20_000 });
  expect(sentIds).toHaveLength(2);
  expect(sentIds[1]).toBe(sentIds[0]);
  await expect(page.getByLabel('오늘 AI 사용량')).toContainText('오늘 남은 요청 19/20');
  expect((await openAiCreates()).filter((request) => request.body?.tools)).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('B2: 전송 뒤 브라우저를 닫고 다시 열면 재로그인 뒤 같은 작업으로 돌아온다', async ({ page, context }) => {
  const { fixture, authenticator } = await setup(page, { hold: true });
  await sendRequest(page, '브라우저 종료 가상 요청');
  await expect(jobStatus(page, '출처 조사')).toBeVisible({ timeout: 20_000 });
  const tripId = fixture.dataset.header.tripId;
  const id = await rememberedJobId(page, tripId);
  const token = await page.evaluate(() => sessionStorage.getItem('travel-app-ai-token'));
  // 다시 연 브라우저: 같은 기기(localStorage·패스키)지만 로그인은 만료된 상태.
  const next = await context.newPage();
  const errors = collectErrors(next);
  await copyPasskeys(authenticator, await addVirtualAuthenticator(next));
  await page.close();
  await next.addInitScript((stored) => {
    const parsed = JSON.parse(stored) as { token: string };
    sessionStorage.setItem(
      'travel-app-ai-token',
      JSON.stringify({ token: parsed.token, expiresAt: '2000-01-01T00:00:00.000Z' }),
    );
  }, token!);
  await next.goto('/?workspace=content');
  await expect(next.getByRole('heading', { level: 1, name: fixture.dataset.header.name, exact: true })).toBeVisible();
  await openMore(next, '변경안');
  await expect(next.getByText('토큰 만료 — 다시 로그인하세요.')).toBeVisible();
  await expect(next.getByText('이 여행의 최근 AI 작업이 있습니다', { exact: false })).toBeVisible();
  await shot(next, 'relogin', next.getByText('이 여행의 최근 AI 작업이 있습니다', { exact: false }));
  await next.getByRole('button', { name: '패스키로 다시 로그인', exact: true }).click();
  await expect(jobStatus(next, '출처 조사')).toBeVisible();
  await configureFakeOpenAi({ hold: false });
  await expect(saved(next)).toBeVisible({ timeout: 20_000 });
  expect(await rememberedJobId(next, tripId)).toBe(id);
  expect(await openAiCreates()).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('B3·B4: 기기 저장이 실패하면 서버 결과를 지키고 "다시 저장"으로 복구한다. 자동 재요청은 없다', async ({
  page,
}) => {
  // IndexedDB 쓰기를 저장 공간 부족으로 실패시키는 스위치. 시험이 켜고 끈다.
  await page.addInitScript(() => {
    const flags = globalThis as unknown as { failIdbWrites?: boolean };
    for (const method of ['put', 'add'] as const) {
      const original = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (this: IDBObjectStore, ...args: Parameters<typeof original>) {
        if (flags.failIdbWrites) {
          throw new DOMException('가상 저장 공간 부족', 'QuotaExceededError');
        }
        return original.apply(this, args);
      };
    }
  });
  const { fixture, errors } = await setup(page, { hold: true });
  await sendRequest(page, '저장 실패 가상 요청');
  await expect(jobStatus(page, '출처 조사')).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => {
    (globalThis as unknown as { failIdbWrites: boolean }).failIdbWrites = true;
  });
  await configureFakeOpenAi({ hold: false });
  const failure = page.getByRole('alert').filter({ hasText: '변경안을 기기에 저장하지 못했습니다' });
  await expect(failure).toBeVisible({ timeout: 20_000 });
  await shot(page, 'stage-failed', failure);
  const id = (await rememberedJobId(page, fixture.dataset.header.tripId))!;
  const kept = await workerJob(page, id);
  expect(kept.status).toBe('awaiting-decision');
  expect(kept.result).toBeDefined();
  await page.evaluate(() => {
    (globalThis as unknown as { failIdbWrites: boolean }).failIdbWrites = false;
  });
  await failure.getByRole('button', { name: '다시 저장', exact: true }).click();
  await expect(saved(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: fixture.output.reason, exact: true })).toBeVisible();
  await expect.poll(async () => (await workerJob(page, id)).status, { timeout: 10_000 }).toBe('acknowledged');
  expect((await workerJob(page, id)).result).toBeUndefined();
  expect(await openAiCreates()).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('B5: 결과가 오기 전에 실제 기록이 추가되면 stale 안내, 서버 결과는 다시 받을 수 있게 남는다', async ({ page }) => {
  const { fixture, errors } = await setup(page, { hold: true });
  await sendRequest(page, 'stale 가상 요청');
  await expect(jobStatus(page, '출처 조사')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '오늘', exact: true }).click();
  await page.getByRole('button', { name: '예정 외 활동 기록', exact: true }).click();
  await page.getByLabel('활동 이름').fill('AI 작업 중 가상 현장 기록');
  await page.getByLabel('기록 메모').fill('stale 검증용');
  await page.getByRole('button', { name: '실제 기록 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await configureFakeOpenAi({ hold: false });
  await openMore(page, '변경안');
  const stale = page.getByRole('alert').filter({ hasText: '계획이 바뀌어 적용할 수 없음 — 새 요청' });
  await expect(stale).toBeVisible({ timeout: 20_000 });
  await expect(stale.getByRole('button', { name: '다시 저장' })).toHaveCount(0);
  await shot(page, 'stale', stale);
  await expect(page.getByRole('heading', { name: fixture.output.reason, exact: true })).toHaveCount(0);
  const id = (await rememberedJobId(page, fixture.dataset.header.tripId))!;
  const job = await workerJob(page, id);
  expect(job.status).toBe('awaiting-decision');
  expect(job.result).toBeDefined();
  expect(await openAiCreates()).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('B6: calling 중 중단·폴링 중 중단 모두 OpenAI 취소 1회, 재호출 없이 중단으로 남는다', async ({ page }) => {
  const { fixture, errors } = await setup(page, { createDelayMs: 4000 });
  const tripId = fixture.dataset.header.tripId;
  await sendRequest(page, 'calling 중 중단 가상 요청');
  await expect(jobStatus(page, 'OpenAI 호출 중')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'AI 작업 중단', exact: true }).click();
  await expect(jobStatus(page, '중단 ·')).toBeVisible();
  await expect.poll(async () => (await openAiCancels()).length, { timeout: 20_000 }).toBe(1);
  const first = (await rememberedJobId(page, tripId))!;
  expect((await workerJob(page, first)).status).toBe('cancelled');
  expect(await openAiCreates()).toHaveLength(1);

  await configureFakeOpenAi({ createDelayMs: 0, hold: true });
  await sendRequest(page, '폴링 중 중단 가상 요청');
  await expect(jobStatus(page, '출처 조사')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'AI 작업 중단', exact: true }).click();
  await expect(jobStatus(page, '중단 ·')).toBeVisible();
  await expect.poll(async () => (await openAiCancels()).length, { timeout: 20_000 }).toBe(2);
  const second = (await rememberedJobId(page, tripId))!;
  expect(second).not.toBe(first);
  expect((await workerJob(page, second)).status).toBe('cancelled');
  expect((await workerJob(page, first)).status).toBe('cancelled');
  expect(await openAiCreates()).toHaveLength(2);
  expect(await inflightCount()).toBe(0);
  expect(errors).toEqual([]);
});

test('B7: 결과 불명 뒤 다시 요청하면 새 작업이 생기고 이전 작업은 불명으로 남는다', async ({ page }) => {
  const { fixture, errors } = await setup(page, { dropAfterCreate: true });
  const tripId = fixture.dataset.header.tripId;
  await sendRequest(page, '생성 뒤 연결이 끊기는 가상 요청');
  const unknown = jobStatus(page, '결과 불명 — 다시 요청');
  await expect(unknown).toBeVisible({ timeout: 20_000 });
  await shot(page, 'unknown', unknown);
  const first = (await rememberedJobId(page, tripId))!;
  await configureFakeOpenAi({ dropAfterCreate: false });
  await sendRequest(page, '다시 보내는 가상 요청');
  await expect(saved(page)).toBeVisible({ timeout: 20_000 });
  const second = (await rememberedJobId(page, tripId))!;
  expect(second).not.toBe(first);
  expect((await workerJob(page, first)).status).toBe('unknown');
  await expect(page.getByLabel('오늘 AI 사용량')).toContainText('오늘 남은 요청 18/20');
  // 첫 작업은 생성 1회(끊김) 뒤 다시 부르지 않았다. 두 번째 작업이 조사·작성 2회.
  expect(await openAiCreates()).toHaveLength(3);
  expect(errors).toEqual([]);
});

test('B8: 결과 조회가 404면 보관 만료로 실패, 5xx가 이어지면 작업 시간 상한 뒤 실패', async ({ page }) => {
  const { errors } = await setup(page, { getFailure: { status: 404, times: 1 } });
  await sendRequest(page, '보관 만료 가상 요청');
  await expect(page.getByText('OpenAI 보관 기간이 지나 결과를 회수하지 못했습니다', { exact: false })).toBeVisible({
    timeout: 20_000,
  });
  await configureFakeOpenAi({ getFailure: { status: 503, times: 100_000 } });
  await sendRequest(page, '5xx 반복 가상 요청');
  await expect(jobStatus(page, '출처 조사')).toBeVisible({ timeout: 20_000 });
  await advanceWorkerClock(16 * 60 * 1000);
  await expect(page.getByText('작업 시간 제한을 넘어 중단했습니다', { exact: false })).toBeVisible({ timeout: 20_000 });
  expect(await openAiCreates()).toHaveLength(2);
  expect(await inflightCount()).toBe(0);
  expect(errors).toEqual([]);
});

test('B9: 여행 A의 작업은 여행 B 화면에 보이지 않고, B로 옮겨도 저장을 거부한다', async ({ page }) => {
  const { fixture, errors } = await setup(page, { hold: true });
  const tripA = fixture.dataset.header.tripId;
  await sendRequest(page, '여행 A 가상 요청');
  await expect(jobStatus(page, '출처 조사')).toBeVisible({ timeout: 20_000 });
  const jobA = (await rememberedJobId(page, tripA))!;
  // 변경안 화면의 `시작 날짜`와 겹치지 않게 다른 화면에서 새 여행을 만든다.
  await page.getByRole('button', { name: '오늘', exact: true }).click();
  await openTripMenu(page);
  await page.getByRole('button', { name: '새 여행', exact: true }).click();
  await page.getByLabel('여행 이름').fill('가상 격리 여행 B');
  await page.getByLabel('시작 날짜').fill('2032-06-01');
  await page.getByLabel('종료 날짜').fill('2032-06-03');
  await page.getByRole('button', { name: '여행 만들기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '가상 격리 여행 B', exact: true, level: 1 })).toBeVisible();
  await openMore(page, '변경안');
  await expect(page.getByRole('heading', { name: 'AI 조사·변경안', exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '출처 조사' })).toHaveCount(0);
  await expect(page.getByText('이 여행의 최근 AI 작업이 있습니다', { exact: false })).toHaveCount(0);
  // 여행 B의 기억 칸에 A의 작업 ID를 억지로 넣는다(다른 여행 결과 저장 시도).
  await page.evaluate(
    async ({ aTrip, aJob, bName }) => {
      const aKey = Object.keys(localStorage).find((key) => key.endsWith(`:${aTrip}`))!;
      const dbName = aKey.slice('travel-app-ai-v2:'.length, aKey.length - aTrip.length - 1);
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const headers = await new Promise<{ tripId: string; name: string }[]>((resolve, reject) => {
        const read = db.transaction('trip_headers').objectStore('trip_headers').getAll();
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error);
      });
      db.close();
      const tripB = headers.find((header) => header.name === bName)!.tripId;
      localStorage.setItem(`travel-app-ai-v2:${dbName}:${tripB}`, aJob);
    },
    { aTrip: tripA, aJob: jobA, bName: '가상 격리 여행 B' },
  );
  await configureFakeOpenAi({ hold: false });
  await expect.poll(async () => (await workerJob(page, jobA)).status, { timeout: 20_000 }).toBe('awaiting-decision');
  await page.reload();
  await expect(page.getByRole('heading', { name: '가상 격리 여행 B', exact: true, level: 1 })).toBeVisible();
  await openMore(page, '변경안');
  await expect(page.getByText('다른 여행의 AI 작업입니다.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: fixture.output.reason, exact: true })).toHaveCount(0);
  expect((await workerJob(page, jobA)).status).toBe('awaiting-decision');
  // 여행 A로 돌아가면 같은 결과를 A에만 저장한다.
  await openTripMenu(page);
  await page
    .getByRole('navigation', { name: '여행 선택' })
    .getByRole('button', { name: fixture.dataset.header.name })
    .click();
  await openMore(page, '변경안');
  await expect(saved(page)).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await workerJob(page, jobA)).status, { timeout: 10_000 }).toBe('acknowledged');
  expect(errors).toEqual([]);
});

test('B10: 오프라인에서는 폴링·전송을 멈추고 저장된 변경안을 거절할 수 있으며, 다시 연결되면 이어서 저장한다', async ({
  page,
  context,
}) => {
  const { fixture, errors } = await setup(page);
  await sendRequest(page, '첫 가상 요청');
  await expect(saved(page)).toBeVisible({ timeout: 20_000 });
  // 1) 오프라인: 미리보기는 되지만 전송 단추는 막히고, 저장된 변경안은 거절할 수 있다.
  await context.setOffline(true);
  const offline = page.getByLabel('AI 연결 상태');
  await expect(offline).toContainText('오프라인');
  await page.getByRole('textbox', { name: '변경 요청', exact: true }).fill('오프라인 중 진행할 가상 요청');
  await page.getByRole('button', { name: '전송할 내용 미리보기', exact: true }).click();
  await page.getByLabel('위 내용 전송과 OpenAI API 유료 실행에 동의', { exact: false }).check();
  const run = page.getByRole('button', { name: '조사하고 초안 만들기', exact: true });
  await expect(run).toBeDisabled();
  await shot(page, 'offline', offline);
  const proposal = page
    .locator('article.content-row')
    .filter({ has: page.getByRole('heading', { name: fixture.output.reason }) });
  await proposal.getByRole('button', { name: '변경안 거절', exact: true }).click();
  await expect(proposal.getByText('거절됨', { exact: false })).toBeVisible();
  // 2) 다시 연결 → 전송 → 진행 중에 오프라인: 폴링 간격(2초)을 넘겨도 작업 조회가 나가지 않는다.
  await context.setOffline(false);
  await expect(offline).toHaveCount(0);
  await configureFakeOpenAi({ hold: true });
  await run.click();
  await expect(jobStatus(page, '출처 조사')).toBeVisible({ timeout: 20_000 });
  const polls: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/ai/v2/jobs/')) {
      polls.push(request.url());
    }
  });
  await context.setOffline(true);
  await expect(offline).toContainText('오프라인');
  await page.waitForTimeout(4500);
  expect(polls).toEqual([]);
  // 3) 다시 연결되면 폴링을 이어 가 같은 작업을 저장한다.
  await context.setOffline(false);
  await expect(offline).toHaveCount(0);
  await configureFakeOpenAi({ hold: false });
  await expect(jobStatus(page, '저장 완료')).toBeVisible({ timeout: 20_000 });
  expect(polls.length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
