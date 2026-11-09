import { expect, test, type Page } from '@playwright/test';
import { buildPackage } from '../../src/transfer/package';
import { digestBytes } from '../../src/contracts/v2';
import { fixtureAssets } from '../fixtures/pilot';
import { aiV2Fixture } from '../fixtures/ai-v2';
import type { AiV2Output, AiV2Request } from '../../src/ai-v2-contract';
import { openMore } from './helpers/nav';
import {
  addVirtualAuthenticator,
  configureFakeOpenAi,
  e2eWorker,
  registerPasskeyInApp,
  resetBackends,
} from './helpers/worker';

// T-D2: 모의 라우트 대신 로컬 Worker(wrangler dev) + 가짜 OpenAI + 가상 패스키로 같은 시나리오를 돈다.
test.use({ baseURL: e2eWorker.appOrigin });

async function openProposals(page: Page) {
  await openMore(page, '변경안');
}

const shotsDirectory = process.env.UI_D01_SHOTS;

async function shot(page: Page, name: string) {
  if (shotsDirectory) {
    await page.screenshot({ path: `${shotsDirectory}/${test.info().project.name}-${name}.png`, fullPage: false });
  }
}

type SetupOptions = {
  delayed?: boolean;
  output?: (fixture: Awaited<ReturnType<typeof aiV2Fixture>>) => AiV2Output;
  beforeConsent?: (page: Page) => Promise<void>;
  prepare?: (dataset: Awaited<ReturnType<typeof aiV2Fixture>>['dataset']) => void;
};

async function importFixtureTrip(page: Page, dataset: Awaited<ReturnType<typeof aiV2Fixture>>['dataset']) {
  await page.goto('/?workspace=content');
  const assets = new Map<string, Uint8Array>();
  for (const bytes of Object.values(fixtureAssets)) {
    assets.set(await digestBytes(bytes), bytes);
  }
  const packaged = await buildPackage(dataset, assets, {
    sourceRepository: 'synthetic/ai-v2',
    sourceCommit: 'fictional-only',
    lineageId: 'synthetic-ai-v2',
    adapterVersion: '1',
    normalizationVersion: '2',
  });
  await page.getByLabel('원천 패키지 가져오기').setInputFiles({
    name: 'fictional-ai-v2.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(await packaged.blob.arrayBuffer()),
  });
  await page.getByRole('button', { name: '여행에 추가', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: dataset.header.name, exact: true })).toBeVisible();
}

async function setup(page: Page, options: SetupOptions = {}) {
  const { delayed = false } = options;
  const fixture = await aiV2Fixture();
  const output = options.output?.(fixture) ?? fixture.output;
  options.prepare?.(fixture.dataset);
  await resetBackends();
  await configureFakeOpenAi({
    outputs: [output],
    hold: delayed,
    pollsBeforeDone: 0,
    sources: fixture.research.sources,
  });
  const bodies: AiV2Request[] = [];
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('request', (request) => {
    if (!/^https?:/.test(request.url())) {
      return;
    }
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      external.push(request.url());
    }
    if (request.method() === 'POST' && url.pathname === '/api/ai/v2/jobs') {
      bodies.push(request.postDataJSON() as AiV2Request);
    }
  });
  await addVirtualAuthenticator(page);
  await importFixtureTrip(page, fixture.dataset);
  await openProposals(page);
  await registerPasskeyInApp(page);
  await page.getByLabel('변경 요청', { exact: true }).fill('실제 API를 사용하지 않는 가상 조사 요청');
  await page.getByRole('button', { name: '전송할 내용 미리보기', exact: true }).click();
  await options.beforeConsent?.(page);
  const run = page.getByRole('button', { name: '조사하고 초안 만들기', exact: true });
  await expect(run).toBeDisabled();
  await page.getByText('OpenAI에 보낼 일정·장소·선택 기록', { exact: true }).click();
  await run.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('v2-ai-consent.png'), fullPage: false });
  await page.getByLabel('위 내용 전송과 OpenAI API 유료 실행에 동의', { exact: false }).check();
  await run.click();
  return {
    ...fixture,
    bodies,
    errors,
    external,
    calls: () => bodies.length,
    privateLeaks: () => bodies.filter((body) => JSON.stringify(body).includes('SYNTHETIC-PRIVATE')).length,
    finish: () => configureFakeOpenAi({ hold: false }),
  };
}

test('v2 모의 결과의 초안 저장·재진입·확인 적용은 한 요청으로 수행한다', async ({ page }) => {
  const fixture = await setup(page);
  await expect(page.getByText('변경안에 저장됨', { exact: false })).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await expect(page.getByRole('heading', { name: '가상 활동 1', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: fixture.output.operations[0].title, exact: true })).toHaveCount(0);
  await openProposals(page);
  await expect(page.getByText('변경안에 저장됨', { exact: false })).toBeVisible({ timeout: 20_000 });
  const proposal = page
    .locator('article.content-row')
    .filter({ has: page.getByRole('heading', { name: fixture.output.reason }) });
  await proposal.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('v2-ai-pending.png'), fullPage: false });
  await proposal.getByRole('button', { name: '확인 후 적용', exact: true }).click();
  await page.getByRole('button', { name: '오늘', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: fixture.output.operations[0].title, exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText('SYNTHETIC-PRIVATE-RESERVATION', { exact: false }).first()).toBeVisible();
  expect(fixture.calls()).toBe(1);
  expect(fixture.privateLeaks()).toBe(0);
  expect(fixture.errors).toEqual([]);
  expect(fixture.external).toEqual([]);
  expect(await page.locator('vite-error-overlay').count()).toBe(0);
  expect(await page.locator('body').evaluate((body) => body.scrollWidth <= innerWidth)).toBe(true);
});

test('v2 조사 중 현장 기록이 추가되면 오래된 결과 자동 저장을 거부한다', async ({ page }) => {
  const fixture = await setup(page, { delayed: true });
  await expect(page.getByText('출처 조사', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '오늘', exact: true }).click();
  await page.getByRole('button', { name: '예정 외 활동 기록', exact: true }).click();
  await page.getByLabel('활동 이름').fill('AI 조사 중 가상 현장 기록');
  await page.getByLabel('기록 메모').fill('오래된 초안 차단 검증용');
  await page.getByRole('button', { name: '실제 기록 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await fixture.finish();
  await openProposals(page);
  await expect(page.getByRole('alert').filter({ hasText: 'CONFLICT' })).toBeVisible();
  await expect(page.getByRole('heading', { name: fixture.output.reason, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '오늘', exact: true }).click();
  await expect(page.getByRole('heading', { name: '가상 활동 1', exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: '기록', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'AI 조사 중 가상 현장 기록', exact: true })).toBeVisible();
  expect(fixture.calls()).toBe(1);
  expect(fixture.errors).toEqual([]);
  expect(fixture.external).toEqual([]);
});

test('미리보기에서 고친 조사 질문이 그대로 전송되고 요청 원문은 조사 DTO에 들어가지 않는다', async ({ page }) => {
  const edited = '가상 장소 1 운영시간을 공식 출처에서 확인';
  const fixture = await setup(page, {
    beforeConsent: async (current) => {
      const question = current.getByLabel('조사 질문 (웹 검색에 보냄)');
      await expect(question).toHaveValue(/운영시간/);
      await question.fill(edited);
      await expect(current.getByText('변경안 작성에 보내는 항목', { exact: false })).toBeVisible();
      await current.getByText('보내지 않는 것', { exact: true }).click();
      await expect(current.getByRole('list', { name: '전송 제외 항목' })).toContainText('사진 캡션');
      await shot(current, 'preview');
    },
  });
  await expect(page.getByText('변경안에 저장됨', { exact: false })).toBeVisible({ timeout: 20_000 });
  const [body] = fixture.bodies;
  expect(body.research.question).toBe(edited);
  expect(JSON.stringify(body.research)).not.toContain('실제 API를 사용하지 않는 가상 조사 요청');
  expect(body.planning.request).toBe('실제 API를 사용하지 않는 가상 조사 요청');
  expect(body.planning.records).toEqual([]);
  expect(fixture.errors).toEqual([]);
  expect(fixture.external).toEqual([]);
});

test('동의 뒤 조사 질문을 고치면 동의가 풀리고 고른 기록만 전송된다', async ({ page }) => {
  const fixture = await setup(page, {
    prepare: (dataset) => {
      const actual = dataset.records.find((record) => record.recordId === 'actual-1');
      if (actual?.kind === 'actual') {
        actual.payload.time = { start: { precision: 'date', date: dataset.header.startDate } };
      }
    },
    beforeConsent: async (current) => {
      const run = current.getByRole('button', { name: '조사하고 초안 만들기', exact: true });
      const consent = current.getByLabel('위 내용 전송과 OpenAI API 유료 실행에 동의', { exact: false });
      await expect(consent).toBeEnabled();
      await consent.check();
      await expect(run).toBeEnabled();
      await current.getByLabel('조사 질문 (웹 검색에 보냄)').fill('바뀐 조사 질문');
      await expect(consent).not.toBeChecked();
      await expect(run).toBeDisabled();
      await current.getByLabel('현장 기록·메모 골라서 포함').check();
      await current.getByRole('list', { name: '보낼 현장 기록 선택' }).getByRole('checkbox').first().check();
      await current.getByRole('button', { name: '전송할 내용 미리보기', exact: true }).click();
      await expect(current.getByText(/기록 1건/)).toBeVisible();
    },
  });
  await expect(page.getByText('변경안에 저장됨', { exact: false })).toBeVisible({ timeout: 20_000 });
  expect(fixture.bodies[0].planning.records).toHaveLength(1);
  expect(fixture.errors).toEqual([]);
});

test('요약 카드를 보이고 확인 필요 항목은 일괄 적용에서 빠진다', async ({ page }) => {
  const fixture = await setup(page, {
    output: ({ input, output, research }) => {
      const items = input.planning.items;
      const booked = items.find((item) => item.fixed)!;
      const other = items.find((item) => item.activityId === 'activity-2')!;
      return {
        ...output,
        reason: '카드 검증용 가상 변경안',
        operations: [
          {
            type: 'edit',
            activityId: booked.activityId,
            dayId: booked.dayId,
            title: '예약 활동 시각 변경',
            summary: '가상 요약',
            reason: '가상: 예약 시간 이동 제안',
            startTime: '10:00',
            endTime: null,
            placeId: booked.placeId,
          },
          {
            type: 'remove',
            activityId: other.activityId,
            dayId: other.dayId,
            title: '',
            summary: '',
            reason: '가상: 이 장소는 빼자는 제안',
            startTime: null,
            endTime: null,
            placeId: null,
          },
        ],
        evidence: [
          {
            url: research.sources[0].url,
            claim: '입장료가 확인됨',
            checkedAt: '2026-01-02',
            operationIndexes: [0, 1],
          },
        ],
      };
    },
  });
  await expect(page.getByText('변경안에 저장됨', { exact: false })).toBeVisible({ timeout: 20_000 });
  const proposal = page
    .locator('article.content-row')
    .filter({ has: page.getByRole('heading', { name: '카드 검증용 가상 변경안' }) });
  const cards = proposal.getByRole('list', { name: '변경안 항목' });
  await expect(cards).toContainText('사유: 가상: 예약 시간 이동 제안');
  await expect(cards).toContainText('출처 1건');
  await expect(cards).toContainText('확인 시각 없음');
  await expect(cards).toContainText('변하는 사실: 미확인');
  await expect(cards).toContainText('확인 필요');
  await expect(cards).toContainText('적용하면 사라지는 이동');
  await expect(proposal.getByText('확인 필요 1건은 표시하지 않으면 적용에서 빠집니다.')).toBeVisible();
  await cards.scrollIntoViewIfNeeded();
  await shot(page, 'cards');
  await proposal.getByRole('button', { name: '확인 후 적용', exact: true }).click();
  await page.getByRole('button', { name: '오늘', exact: true }).click();
  await expect(page.getByRole('heading', { name: '가상 활동 1', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: '가상 활동 2', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '예약 활동 시각 변경', exact: true })).toHaveCount(0);
  expect(fixture.calls()).toBe(1);
  expect(fixture.errors).toEqual([]);
  expect(fixture.external).toEqual([]);
});

function flightDay(dataset: Awaited<ReturnType<typeof aiV2Fixture>>['dataset']) {
  const plan = dataset.plans[0];
  plan.legs[0].mode = 'flight';
  plan.items[1].time = {
    start: { precision: 'local', date: plan.days[0].date, localTime: '14:20', timeZoneStatus: 'unknown' },
  };
}

test('비운 도착 시각은 전송 본문에 키가 없다', async ({ page }) => {
  const fixture = await setup(page, {
    prepare: flightDay,
    beforeConsent: async (current) => {
      await current.getByText('도착·출발 시각 (이 요청에만 사용)', { exact: true }).click();
      const arrival = current.getByLabel(/2026-10-31 도착/);
      await expect(arrival).toHaveValue('14:20');
      await expect(current.getByText(/2026-10-31 도착 \(이동에서 추정\)/)).toBeVisible();
      await arrival.fill('');
      await expect(arrival).toHaveValue('');
      await current.getByRole('button', { name: '전송할 내용 미리보기', exact: true }).click();
    },
  });
  await expect(page.getByText('변경안에 저장됨', { exact: false })).toBeVisible({ timeout: 20_000 });
  const [day] = fixture.bodies[0].planning.days;
  expect(Object.keys(day)).not.toContain('arrival');
  expect(JSON.stringify(day)).not.toContain('14:20');
  expect(fixture.errors).toEqual([]);
});

test('채운 도착 시각은 화면 값과 전송 값이 같다', async ({ page }) => {
  const fixture = await setup(page, {
    prepare: flightDay,
    beforeConsent: async (current) => {
      await current.getByText('도착·출발 시각 (이 요청에만 사용)', { exact: true }).click();
      const arrival = current.getByLabel(/2026-10-31 도착/);
      await arrival.fill('15:30');
      await expect(arrival).toHaveValue('15:30');
      await current.getByRole('button', { name: '전송할 내용 미리보기', exact: true }).click();
    },
  });
  await expect(page.getByText('변경안에 저장됨', { exact: false })).toBeVisible({ timeout: 20_000 });
  expect(fixture.bodies[0].planning.days[0].arrival).toBe('15:30');
  expect(fixture.errors).toEqual([]);
});
