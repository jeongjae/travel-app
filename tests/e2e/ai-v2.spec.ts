import { expect, test, type Page } from '@playwright/test';
import { buildPackage } from '../../src/transfer/package';
import { digestBytes } from '../../src/contracts/v2';
import { fixtureAssets } from '../fixtures/pilot';
import { aiV2Fixture } from '../fixtures/ai-v2';
import { materializeV2Proposal } from '../../server/ai-v2';
import type { AiV2Request } from '../../src/ai-v2-contract';
import type { AiV2Job } from '../../server/ai-v2-jobs';

async function expand(page: Page, selector: string) {
  const details = page.locator(selector);
  if (!(await details.getAttribute('open'))) {
    if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) {
      await details.locator(':scope > summary').click();
    }
  }
}

async function openProposals(page: Page) {
  await expand(page, '.journey-extras');
  await page.getByRole('button', { name: '변경안', exact: true }).click();
}

async function setup(page: Page, delayed = false) {
  const fixture = await aiV2Fixture();
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('request', (request) => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).hostname !== '127.0.0.1') {
      external.push(request.url());
    }
  });
  let stored: AiV2Job | undefined;
  let calls = 0;
  let ready = !delayed;
  await page.route('**/api/ai/v2/**', async (route) => {
    const request = route.request();
    if (request.url().endsWith('/status')) {
      await route.fulfill({ json: { configured: true, model: 'fictional-provider-no-api' } });
      return;
    }
    if (request.method() === 'POST' && request.url().endsWith('/jobs')) {
      calls++;
      const input = request.postDataJSON() as AiV2Request;
      expect(JSON.stringify(input)).not.toContain('SYNTHETIC-PRIVATE');
      expect(input.context.records).toEqual([]);
      stored = {
        id: input.id,
        tripId: input.context.header.tripId,
        baseDomainRevision: input.context.header.domainRevision,
        basePlanVersionId: input.context.plan.planVersionId,
        status: ready ? 'awaiting-decision' : 'researching',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        model: 'fictional-provider-no-api',
        attempt: 1,
        sources: fixture.research.sources,
        result: materializeV2Proposal(input, fixture.output, fixture.research),
      };
      await route.fulfill({ status: 202, json: stored });
      return;
    }
    await route.fulfill({
      status: stored ? 200 : 404,
      json: stored ? { ...stored, status: ready ? 'awaiting-decision' : 'researching' } : { error: '모의 작업 없음' },
    });
  });
  await page.goto('/?workspace=content');
  const assets = new Map<string, Uint8Array>();
  for (const bytes of Object.values(fixtureAssets)) {
    assets.set(await digestBytes(bytes), bytes);
  }
  const packaged = await buildPackage(fixture.dataset, assets, {
    sourceRepository: 'synthetic/ai-v2',
    sourceCommit: 'fictional-only',
    lineageId: 'synthetic-ai-v2',
    adapterVersion: '1',
    normalizationVersion: '2',
  });
  await page.getByLabel('여행 패키지 선택').setInputFiles({
    name: 'fictional-ai-v2.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(await packaged.blob.arrayBuffer()),
  });
  await page.getByRole('button', { name: '여행에 추가', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: fixture.dataset.header.name, exact: true })).toBeVisible();
  await openProposals(page);
  await page.getByLabel('변경 요청', { exact: true }).fill('실제 API를 사용하지 않는 가상 조사 요청');
  await page.getByRole('button', { name: '전송할 내용 미리보기', exact: true }).click();
  const run = page.getByRole('button', { name: '조사하고 초안 만들기', exact: true });
  await expect(run).toBeDisabled();
  await page.getByText('OpenAI에 보낼 일정·장소·선택 기록', { exact: true }).click();
  await run.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('v2-ai-consent.png'), fullPage: false });
  await page.getByLabel('위 내용 전송과 OpenAI API 유료 실행에 동의', { exact: false }).check();
  await run.click();
  return {
    ...fixture,
    errors,
    external,
    calls: () => calls,
    finish: () => {
      ready = true;
    },
  };
}

test('v2 모의 결과의 초안 저장·재진입·확인 적용은 한 요청으로 수행한다', async ({ page }) => {
  const fixture = await setup(page);
  await expect(page.getByText('변경안에 저장됨', { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '가상 활동 1', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: fixture.output.operations[0].title, exact: true })).toHaveCount(0);
  await openProposals(page);
  await expect(page.getByText('변경안에 저장됨', { exact: false })).toBeVisible();
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
  expect(fixture.errors).toEqual([]);
  expect(fixture.external).toEqual([]);
  expect(await page.locator('vite-error-overlay').count()).toBe(0);
  expect(await page.locator('body').evaluate((body) => body.scrollWidth <= innerWidth)).toBe(true);
});

test('v2 조사 중 현장 기록이 추가되면 오래된 결과 자동 저장을 거부한다', async ({ page }) => {
  const fixture = await setup(page, true);
  await expect(page.getByText('출처 조사', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '오늘', exact: true }).click();
  await page.getByRole('button', { name: '예정 외 활동 기록', exact: true }).click();
  await page.getByLabel('활동 이름').fill('AI 조사 중 가상 현장 기록');
  await page.getByLabel('기록 메모').fill('오래된 초안 차단 검증용');
  await page.getByRole('button', { name: '실제 기록 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  fixture.finish();
  await openProposals(page);
  await expect(page.getByRole('alert').filter({ hasText: 'CONFLICT' })).toBeVisible();
  await expect(page.getByRole('heading', { name: fixture.output.reason, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '오늘', exact: true }).click();
  await expect(page.getByRole('heading', { name: '가상 활동 1', exact: true }).first()).toBeVisible();
  await expand(page, '.journey-extras');
  await page.getByRole('button', { name: '실제 기록', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'AI 조사 중 가상 현장 기록', exact: true })).toBeVisible();
  expect(fixture.calls()).toBe(1);
  expect(fixture.errors).toEqual([]);
  expect(fixture.external).toEqual([]);
});
