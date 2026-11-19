import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { openTripMenu, skipPlaceStage } from './helpers/nav';

/**
 * T-E1 C2: AI 결과 붙여넣기 → 미리보기 → 새 여행 저장. 가상 고정 자료만 쓴다.
 * 네트워크 요청 없이 동작해야 하므로 오프라인 상태에서도 확인한다.
 */
const T1 = readFileSync('tests/fixtures/plan-format/chatgpt-t1-run2.md', 'utf8');
const T1_NAME = '후쿠오카 봄 여행 3박 4일';

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

async function openPasteDialog(page: Page) {
  await openTripMenu(page);
  await page.getByRole('button', { name: 'AI 결과 붙여넣기', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

async function pasteAndPreview(page: Page, text: string) {
  await page.getByLabel('붙여 넣은 글').fill(text);
  await page.getByRole('button', { name: '미리보기', exact: true }).click();
}

async function saveTrip(page: Page) {
  await page.getByRole('button', { name: '새 여행으로 저장', exact: true }).click();
  await skipPlaceStage(page);
  await expect(page.getByRole('heading', { name: T1_NAME, exact: true, level: 1 })).toBeVisible();
}

test('붙여넣기 → 미리보기 수치 → 저장 → 첫날 활동, 다시 넣으면 같은 이름 확인', async ({ page }) => {
  await page.goto('/?workspace=content');
  await openPasteDialog(page);
  await pasteAndPreview(page, T1);
  await expect(page.getByTestId('preview-counts')).toHaveText('활동 32개 · 숙소 1곳');
  await expect(page.getByRole('heading', { name: T1_NAME, level: 3 })).toBeVisible();
  await expect(page.getByText('구역 "이동" 9줄')).toBeVisible();
  await expect(page.getByText('구역 "장소" 16줄', { exact: false })).toBeVisible();
  await expect(page.getByText('(앱이 추가하는 활동)')).toHaveCount(0);
  await expect(page.getByText('메모에 덧붙이는 내용 1건')).toBeVisible();

  await saveTrip(page);
  await expect(page.getByText('여행을 만들었습니다. 활동 32개 · 숙소 1곳')).toBeVisible();
  await page.getByRole('button', { name: '오늘', exact: true }).first().click();
  await expect(page.locator('.day-timeline h3').first()).toHaveText('인천공항 출국 및 후쿠오카행 항공 이동');

  // 같은 글을 다시 넣으면 확인 전에는 저장할 수 없다.
  await openPasteDialog(page);
  await pasteAndPreview(page, T1);
  const saveButton = page.getByRole('button', { name: '새 여행으로 저장', exact: true });
  await expect(page.getByText('같은 이름의 여행이 있습니다', { exact: false })).toBeVisible();
  await expect(saveButton).toBeDisabled();
  await page.getByLabel('같은 이름의 여행이 있습니다', { exact: false }).check();
  await expect(saveButton).toBeEnabled();
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await openTripMenu(page);
  await expect(page.locator('.trip-list .trip-item')).toHaveCount(1);
});

test('파일 선택도 같은 미리보기 수치를 낸다', async ({ page }) => {
  await page.goto('/?workspace=content');
  await openPasteDialog(page);
  await page
    .getByRole('dialog')
    .locator('input[type="file"]')
    .setInputFiles({ name: 'plan.md', mimeType: 'text/markdown', buffer: Buffer.from(T1, 'utf8') });
  await expect(page.getByTestId('preview-counts')).toHaveText('활동 32개 · 숙소 1곳');
  await expect(page.getByLabel('붙여 넣은 글')).toHaveValue(T1);
});

test('양식이 아닌 글은 다시 요청하는 방법을 안내하고 저장 단추가 없다', async ({ page }) => {
  await page.goto('/?workspace=content');
  await openPasteDialog(page);
  await pasteAndPreview(page, '후쿠오카 3박 4일 일정 요약입니다. 표는 없습니다.');
  await expect(page.getByRole('alert')).toContainText('앱 양식의 코드 블록 하나로 다시 정리해 줘');
  await expect(page.getByRole('button', { name: '새 여행으로 저장', exact: true })).toHaveCount(0);
});

test('오류로 빠지는 표는 줄 번호와 이유를 보여 주고 확인해야 저장할 수 있다. 글을 고치면 확인이 무효가 된다', async ({
  page,
}) => {
  const broken = T1.replace('08:00-10:30', '08:00-08:00');
  await page.goto('/?workspace=content');
  await openPasteDialog(page);
  await pasteAndPreview(page, broken);
  await expect(page.getByRole('heading', { name: '오류 때문에 빠지는 표 1개' })).toBeVisible();
  await expect(page.getByText('길이가 0', { exact: false })).toBeVisible();
  const saveButton = page.getByRole('button', { name: '새 여행으로 저장', exact: true });
  await expect(saveButton).toBeDisabled();
  await page.getByLabel('위 표는 빼고 나머지만 저장하는 것을 확인했습니다').check();
  await expect(saveButton).toBeEnabled();
  await page.getByLabel('붙여 넣은 글').fill(`${broken}
`);
  await expect(saveButton).toHaveCount(0);
  await page.getByRole('button', { name: '미리보기', exact: true }).click();
  await expect(page.getByLabel('위 표는 빼고 나머지만 저장하는 것을 확인했습니다')).not.toBeChecked();
  // 첫날(8개)이 빠지면 체크인 날의 숙박 줄도 없어져 앱이 숙소 활동을 하나 추가한다.
  await expect(page.getByText('(앱이 추가하는 활동)')).toHaveCount(1);
  await page.getByLabel('위 표는 빼고 나머지만 저장하는 것을 확인했습니다').check();
  await saveTrip(page);
  await expect(page.getByText('여행을 만들었습니다. 활동 25개 · 숙소 1곳')).toBeVisible();
});

test('오프라인에서도 붙여넣기 → 저장 → 재실행 뒤 같은 여행을 읽는다', async ({ page }) => {
  await page.goto('/?workspace=content');
  await openTripMenu(page);
  await page.context().setOffline(true);
  await openPasteDialog(page);
  await pasteAndPreview(page, T1);
  await expect(page.getByTestId('preview-counts')).toHaveText('활동 32개 · 숙소 1곳');
  await saveTrip(page);
  await page.context().setOffline(false);
  await page.reload();
  await expect(page.getByRole('heading', { name: T1_NAME, exact: true, level: 1 })).toBeVisible();
});
