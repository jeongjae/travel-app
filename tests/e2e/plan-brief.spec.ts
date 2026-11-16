import { test, expect, type Page } from '@playwright/test';
import { openTripMenu } from './helpers/nav';

/** T-E1 C3: "AI로 계획 만들기" → 질문(모두 선택) → 요청서 복사. 서버 요청 없이 동작한다. */
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

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

async function openBrief(page: Page) {
  await page.goto('/?workspace=content');
  await openTripMenu(page);
  await page.getByRole('button', { name: 'AI로 계획 만들기', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

test('아무것도 답하지 않아도 요청서가 복사되고, 답한 것만 들어간다', async ({ page }) => {
  await openBrief(page);
  const preview = page.getByLabel('요청서 미리보기');
  await expect(preview).toHaveValue(/^아직 여행지와 기간을 정하지 않았어\./);
  await page.getByRole('button', { name: '요청서 복사', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('요청서를 복사했습니다');
  const empty = await clipboard(page);
  expect(empty).toContain('[부탁할 일]');
  expect(empty).toContain('travel-app-plan/1');
  expect(empty).not.toContain('[기본 조건]');

  await page.getByLabel('여행지 (여러 곳은 쉼표로)').fill('후쿠오카');
  await page.getByRole('button', { name: '미식', exact: true }).click();
  await page.getByRole('button', { name: '여유', exact: true }).click();
  await page.getByText('상세 설정').click();
  await page.getByRole('button', { name: '부부', exact: true }).click();
  await page.getByLabel('인원').fill('2');
  await expect(preview).toHaveValue(/아직 기간을 정하지 않았어/);
  await expect(preview).toHaveValue(/- 여행지: 후쿠오카\n- 동행: 부부, 2명/);
  await expect(preview).toHaveValue(/- 중요한 것: 미식\n- 속도: 여유/);
  // 다시 누르면 선택이 풀려 요청서에서 빠진다.
  await page.getByRole('button', { name: '미식', exact: true }).click();
  await expect(preview).not.toHaveValue(/중요한 것/);
});

test('기간이 뒤집히면 복사할 수 없다', async ({ page }) => {
  await openBrief(page);
  await page.getByLabel('시작 날짜').fill('2027-04-18');
  await page.getByLabel('종료 날짜').fill('2027-04-15');
  await expect(page.getByRole('alert')).toContainText('이릅니다');
  await expect(page.getByRole('button', { name: '요청서 복사', exact: true })).toBeDisabled();
});

test('양식 안내문만 복사하고, 복사가 막히면 글을 펼쳐 보여 준다', async ({ page }) => {
  await openBrief(page);
  await page.getByRole('button', { name: '양식 안내문만 복사', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('양식 안내문만 복사했습니다');
  const prompt = await clipboard(page);
  expect(prompt.startsWith('너는 내 여행 계획을 도와주고')).toBe(true);
  expect(prompt).not.toContain('[부탁할 일]');

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('blocked')) },
    });
  });
  await page.getByRole('button', { name: '요청서 복사', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('자동 복사가 막혀 있습니다');
  await expect(page.getByLabel('복사할 글')).toHaveValue(/\[부탁할 일\]/);
});
