import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { openTripMenu } from './helpers/nav';

/** T-P2-1: 준비 자료 파일(가이드 + 고른 것 + 취향 답) 저장 → 불러오기. 가상 고정 자료만 쓴다. */
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const GUIDE = readFileSync('tests/fixtures/guide-format/hakodate.md', 'utf8');

let browserErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  browserErrors = [];
  page.on('pageerror', (e) => browserErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') {
      browserErrors.push(m.text());
    }
  });
});
test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) {
    expect(browserErrors).toEqual([]);
    expect(await page.locator('body').evaluate((e) => e.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

const card = (page: Page, name: string) => page.locator('.guide-card').filter({ hasText: name }).first();

async function choose(page: Page, name: string, label: '꼭 포함' | '관심' | '제외') {
  await card(page, name).getByRole('button', { name: label, exact: true }).click();
}

async function openBrief(page: Page) {
  await page.goto('/?workspace=content');
  await openTripMenu(page);
  await page.getByRole('button', { name: 'AI로 계획 만들기', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

/** 가이드를 넣고 두 건을 고른 뒤 준비 자료 글을 저장해 돌려준다. 예산은 "100만원"으로 둔다. */
async function savePrepFile(page: Page) {
  await openBrief(page);
  await page.getByLabel('예산').fill('100만원');
  await page.getByLabel('붙여 넣은 가이드').fill(GUIDE);
  await page.getByRole('button', { name: '가이드 읽기', exact: true }).click();
  await choose(page, '하코다테산 전망대', '꼭 포함');
  await choose(page, '구 영국영사관', '제외');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '준비 자료 저장', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('준비자료-일본 하코다테.md');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function clearGuide(page: Page) {
  await page.getByRole('button', { name: '가이드 지우기', exact: true }).click();
  await page.getByRole('button', { name: '지우기', exact: true }).click();
  await expect(page.locator('.guide-card')).toHaveCount(0);
}

test('저장 → 초안 지우기 → 가이드 칸에 넣기 → 미리보기 → 반영하면 같은 2건과 취향 답이 돌아온다', async ({ page }) => {
  const saved = await savePrepFile(page);
  expect(saved).toContain('- 양식: travel-app-prep/1');
  await expect(page.getByText('가이드, 고른 것, 취향 답(예산·동행 포함)이 글 그대로 들어갑니다.')).toBeVisible();
  await clearGuide(page);
  await page.getByLabel('예산').fill('1만원');

  await page.getByLabel('붙여 넣은 가이드').fill(saved);
  await page.getByRole('button', { name: '가이드 읽기', exact: true }).click();
  const preview = page.getByRole('region', { name: '준비 자료 미리보기' });
  await expect(preview).toContainText('일본 하코다테');
  await expect(preview).toContainText('가이드 항목 34개');
  await expect(preview).toContainText('고른 것 2건 (꼭 포함 1 · 관심 0 · 제외 1');
  await expect(preview).toContainText('취향 답 1칸');
  await expect(preview.getByLabel('고른 것도 가져오기')).toBeChecked();
  await expect(preview.getByLabel('취향 답도 가져오기')).not.toBeChecked();
  await preview.getByLabel('취향 답도 가져오기').check();
  await preview.getByRole('button', { name: '준비 자료 반영', exact: true }).click();

  await expect(page.locator('.guide-card')).toHaveCount(34);
  await expect(page.getByTestId('guide-total')).toContainText('꼭 포함 1 · 관심 0 · 제외 1');
  await expect(card(page, '하코다테산 전망대').getByRole('button', { name: '꼭 포함', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(card(page, '구 영국영사관').getByRole('button', { name: '제외', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByLabel('예산')).toHaveValue('100만원');
});

test('"고른 것도 가져오기"를 끄면 고른 것 0건, 취향 답은 그대로', async ({ page }) => {
  const saved = await savePrepFile(page);
  await clearGuide(page);
  await page.getByLabel('예산').fill('1만원');
  await page.getByLabel('붙여 넣은 가이드').fill(saved);
  await page.getByRole('button', { name: '가이드 읽기', exact: true }).click();
  const preview = page.getByRole('region', { name: '준비 자료 미리보기' });
  await preview.getByLabel('고른 것도 가져오기').uncheck();
  await preview.getByRole('button', { name: '준비 자료 반영', exact: true }).click();
  await expect(page.locator('.guide-card')).toHaveCount(34);
  await expect(page.getByTestId('guide-total')).toContainText('꼭 포함 0 · 관심 0 · 제외 0');
  await expect(page.getByLabel('예산')).toHaveValue('1만원');
});

test('지금 초안에 가이드가 있으면 확인을 받고, 취소하면 그대로다', async ({ page }) => {
  const saved = await savePrepFile(page);
  await page.getByRole('button', { name: '가이드 바꾸기', exact: true }).click();
  await page.getByLabel('붙여 넣은 가이드').fill(saved);
  await page.getByRole('button', { name: '가이드 읽기', exact: true }).click();
  const preview = page.getByRole('region', { name: '준비 자료 미리보기' });
  await preview.getByRole('button', { name: '준비 자료 반영', exact: true }).click();
  await expect(preview.getByText('지금의 가이드와 고른 것 2건을 바꿉니다.')).toBeVisible();
  await preview.getByRole('button', { name: '취소', exact: true }).click();
  await expect(preview.getByRole('button', { name: '준비 자료 반영', exact: true })).toBeVisible();
  await expect(page.getByTestId('guide-total')).toContainText('꼭 포함 1 · 관심 0 · 제외 1');
  await preview.getByRole('button', { name: '준비 자료 반영', exact: true }).click();
  await preview.getByRole('button', { name: '바꾸기', exact: true }).click();
  await expect(page.getByTestId('guide-total')).toContainText('꼭 포함 1 · 관심 0 · 제외 1');
});

test('깨진 준비 자료는 한글 이유로 거절하고 초안은 그대로, 계획 화면에는 안내가 뜬다', async ({ page }) => {
  const saved = await savePrepFile(page);
  await page.getByRole('button', { name: '가이드 바꾸기', exact: true }).click();
  await page.getByLabel('붙여 넣은 가이드').fill(saved.replace('travel-app-prep/1', 'travel-app-prep/9'));
  await page.getByRole('button', { name: '가이드 읽기', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '지원하지 않는 준비 자료 양식' })).toBeVisible();
  await expect(page.getByTestId('guide-total')).toContainText('꼭 포함 1 · 관심 0 · 제외 1');

  await page.reload();
  await openTripMenu(page);
  await page.getByRole('button', { name: 'AI 결과 붙여넣기', exact: true }).click();
  await page.getByLabel('붙여 넣은 글').fill(saved);
  await page.getByRole('button', { name: '미리보기', exact: true }).click();
  await expect(page.getByText("준비 자료입니다. 'AI로 계획 만들기'의 가이드 칸에 넣어 주세요.")).toBeVisible();
});
