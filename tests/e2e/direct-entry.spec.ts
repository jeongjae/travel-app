import { test, expect, type Page } from '@playwright/test';
import { menuAction, openMore, openTripMenu } from './helpers/nav';

/** T-E3-2b: 활동 칸(D1)·날짜 제목·도시(D2)·여행 이름(D3)·계획 버전 표시(D4). 가상 자료만 쓴다. */
const CAPTURE_DIR = process.env.E032B_CAPTURE;

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

async function capture(page: Page, name: string, target = page.getByRole('dialog')) {
  if (!CAPTURE_DIR) {
    return;
  }
  const suffix = (page.viewportSize()?.width ?? 0) < 600 ? 'm' : 'pc';
  await target.screenshot({ path: `${CAPTURE_DIR}/${name}-${suffix}.png` });
}

async function newTrip(page: Page) {
  await page.goto('/?workspace=content');
  await openTripMenu(page);
  await page.getByRole('button', { name: '새 여행', exact: true }).click();
  await page.getByLabel('여행 이름').fill('직접 입력 가상 여행');
  await page.getByLabel('시작 날짜').fill('2032-05-01');
  await page.getByLabel('종료 날짜').fill('2032-05-02');
  await page.getByRole('button', { name: '여행 만들기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '직접 입력 가상 여행', exact: true, level: 1 })).toBeVisible();
}

test('활동에 종류·설명·식사·예약 안내·선택 활동을 넣고 다시 열면 그대로다. 빈 값은 지운다', async ({ page }) => {
  await newTrip(page);
  await page.getByRole('button', { name: '활동 추가', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('종류')).toHaveValue('기타');
  await dialog.getByLabel('활동 제목').fill('가상 시장 구경');
  await dialog.getByLabel('종류').selectOption('식사');
  await dialog.getByLabel('설명 (선택)').fill('아침 시장을 둘러본다.\n두 번째 줄');
  await dialog.getByLabel('식사·메뉴 (선택)').fill('해산물 덮밥');
  await dialog.getByLabel('예약 안내 (선택)').fill('예약 없이 방문');
  await dialog.getByLabel('선택 활동').check();
  await capture(page, 'activity-form');
  await dialog.getByRole('button', { name: '계획 저장', exact: true }).click();
  await expect(page.getByRole('heading', { name: '가상 시장 구경', exact: true })).toBeVisible();

  await menuAction(page, '일정 수정');
  await expect(dialog.getByLabel('종류')).toHaveValue('식사');
  await expect(dialog.getByLabel('설명 (선택)')).toHaveValue('아침 시장을 둘러본다.\n두 번째 줄');
  await expect(dialog.getByLabel('식사·메뉴 (선택)')).toHaveValue('해산물 덮밥');
  await expect(dialog.getByLabel('예약 안내 (선택)')).toHaveValue('예약 없이 방문');
  await expect(dialog.getByLabel('선택 활동')).toBeChecked();
  await dialog.getByLabel('식사·메뉴 (선택)').fill('');
  await dialog.getByLabel('예약 안내 (선택)').fill('  ');
  await dialog.getByLabel('선택 활동').uncheck();
  await dialog.getByRole('button', { name: '계획 저장', exact: true }).click();
  await expect(dialog).toBeHidden();

  await menuAction(page, '일정 수정');
  await expect(dialog.getByLabel('식사·메뉴 (선택)')).toHaveValue('');
  await expect(dialog.getByLabel('예약 안내 (선택)')).toHaveValue('');
  await expect(dialog.getByLabel('선택 활동')).not.toBeChecked();
  await expect(dialog.getByLabel('종류')).toHaveValue('식사');
});

test('날짜 제목·도시를 고치면 일정 화면에 보이고, 바뀐 것이 없으면 저장할 수 없다', async ({ page }) => {
  await newTrip(page);
  await page.getByRole('button', { name: '날짜 정보 수정', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const save = dialog.getByRole('button', { name: '날짜 정보 저장', exact: true });
  await expect(save).toBeDisabled();
  await dialog.getByLabel('날짜 제목').fill('   ');
  await expect(save).toBeDisabled();
  await dialog.getByLabel('날짜 제목').fill('가상 항구 산책의 날');
  await dialog.getByLabel('도시 (선택)').fill('가상 항구시');
  await expect(save).toBeEnabled();
  await capture(page, 'day-info');
  await save.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('날짜 정보를 저장했습니다.')).toBeVisible();
  await expect(page.getByText('가상 항구 산책의 날').first()).toBeVisible();
  await expect(page.getByText('가상 항구시').first()).toBeVisible();
});

test('여행 이름을 바꾸면 머리글에 새 이름이 보이고 빈 이름은 저장할 수 없다', async ({ page }) => {
  await newTrip(page);
  await openMore(page, '여행 이름 바꾸기');
  const dialog = page.getByRole('dialog');
  const save = dialog.getByRole('button', { name: '이름 저장', exact: true });
  await expect(save).toBeDisabled();
  await dialog.getByLabel('여행 이름').fill(' ');
  await expect(save).toBeDisabled();
  await dialog.getByLabel('여행 이름').fill('이름을 바꾼 가상 여행');
  await capture(page, 'rename');
  await save.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: '이름을 바꾼 가상 여행', exact: true, level: 1 })).toBeVisible();
  await openTripMenu(page);
  await expect(page.locator('.journey-library').getByText('이름을 바꾼 가상 여행').first()).toBeVisible();
});

test('계획 버전 화면: 고른 계획과 저장 번호가 좁은 화면에서도 읽힌다', async ({ page }) => {
  await newTrip(page);
  await page.getByRole('button', { name: '활동 추가', exact: true }).click();
  await page.getByLabel('활동 제목').fill('버전을 만드는 가상 활동');
  await page.getByRole('button', { name: '계획 저장', exact: true }).click();
  await expect(page.getByRole('heading', { name: '버전을 만드는 가상 활동', exact: true })).toBeVisible();
  await openMore(page, '계획 버전');
  const section = page.locator('section.more-page').filter({ has: page.getByRole('heading', { name: '계획 버전' }) });
  await expect(section.getByText(/^보고 있는 계획: 계획 \d+ · 사용자 일정 수정$/)).toBeVisible();
  await expect(section.getByText(/^저장 번호\(revision\) \d+$/)).toBeVisible();
  await capture(page, 'cl45-after', section);
});
