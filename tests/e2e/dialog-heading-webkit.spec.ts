import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { openTripMenu } from './helpers/nav';

/** T-E2 R3: iPhone(WebKit)에서도 창 제목 줄과 고르기 요약 줄이 겹치지 않는다. */
const GUIDE = readFileSync('tests/fixtures/guide-format/hakodate.md', 'utf8');

const CAPTURE_DIR = process.env.R3_CAPTURE_DIR;

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
  }
});

async function box(locator: ReturnType<Page['locator']>) {
  const rect = await locator.boundingBox();
  if (!rect) {
    throw new Error('보이지 않는 요소');
  }
  return rect;
}

test('가이드 고르기: 끝까지 스크롤해도 제목·닫기가 보이고 요약 줄이 그 바로 아래에 붙으며 닫기가 동작한다', async ({
  page,
}) => {
  await page.goto('/?workspace=content');
  await openTripMenu(page);
  await page.getByRole('button', { name: 'AI로 계획 만들기', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await page.getByLabel('붙여 넣은 가이드').fill(GUIDE);
  await page.getByRole('button', { name: '가이드 읽기', exact: true }).click();
  const sticky = dialog.locator('.guide-sticky');
  await expect(sticky).toBeVisible();
  // 목록 한가운데까지 스크롤한다(목록이 끝나면 요약 줄도 목록과 함께 올라가는 것이 정상이다).
  await dialog.evaluate((element) => {
    const panel = element.querySelector('.guide-panel')!.getBoundingClientRect();
    const frame = element.getBoundingClientRect();
    element.scrollTop += panel.top - frame.top + panel.height * 0.6;
  });
  const heading = dialog.locator('.dialog-heading');
  const close = heading.getByRole('button', { name: '닫기', exact: true });
  await expect(heading.getByRole('heading', { name: 'AI로 계획 만들기' })).toBeVisible();
  await expect(close).toBeVisible();
  const headingBox = await box(heading);
  const stickyBox = await box(sticky);
  const dialogBox = await box(dialog);
  expect(headingBox.y).toBeGreaterThanOrEqual(dialogBox.y - 1);
  expect(headingBox.y + headingBox.height).toBeLessThanOrEqual(dialogBox.y + dialogBox.height);
  expect(Math.abs(stickyBox.y - (headingBox.y + headingBox.height))).toBeLessThanOrEqual(1);
  const closeBox = await box(close);
  expect(closeBox.height).toBeLessThanOrEqual(30);
  const fixedHeight = Math.round(stickyBox.y + stickyBox.height - dialogBox.y);
  console.log(`고정 영역 높이 ${test.info().project.name}: ${fixedHeight}px`);
  {
  }
  if (CAPTURE_DIR) {
    await page.screenshot({ path: `${CAPTURE_DIR}/guide-select-scrolled-${test.info().project.name}.png` });
  }
  await close.click();
  await expect(dialog).not.toBeVisible();
});
