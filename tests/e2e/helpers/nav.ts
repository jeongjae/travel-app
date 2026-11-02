import { expect, type Locator, type Page } from '@playwright/test';

/** 헤더의 여행 이름을 눌러 여행 전환·새 여행·가져오기 영역을 연다. 이미 열려 있으면 그대로 둔다. */
export async function openTripMenu(page: Page) {
  const panel = page.locator('.journey-library');
  const toggle = page.locator('.trip-switch');
  // 여행이 없으면 영역이 처음부터 열려 있고, 있으면 이름 단추가 보인다. 저장소를 읽는 동안은 둘 다 없다.
  await expect(panel.or(toggle).first()).toBeVisible();
  if (await panel.isVisible()) {
    return;
  }
  await toggle.click();
  await expect(panel).toBeVisible();
}

/** 하단 탭 `더보기`를 열고 목록에서 항목을 고른다. 어느 화면에서든 같은 두 번의 누름으로 닿는다. */
export async function openMore(page: Page, name: string) {
  await page
    .getByRole('navigation', { name: '주요 메뉴' })
    .getByRole('button', { name: '더보기', exact: true })
    .click();
  await page.getByRole('navigation', { name: '더보기 메뉴' }).getByRole('button', { name, exact: true }).click();
}

/** 더보기 > 저장소·백업. 대화상자는 호출한 쪽에서 확인한다. */
export async function openStorage(page: Page) {
  // 여행이 없으면 하단 탭이 없으므로 시작 화면의 단추를 쓴다. 저장소를 읽는 동안은 둘 다 없으므로 하나가 보일 때까지 기다린다.
  const mainNav = page.getByRole('navigation', { name: '주요 메뉴' });
  const startButton = page.getByRole('button', { name: '저장소·백업', exact: true });
  await expect(mainNav.or(startButton).first()).toBeVisible();
  if (await startButton.isVisible()) {
    await startButton.click();
    return;
  }
  await openMore(page, '저장소·백업');
}

/** 날짜 띠에서 ISO 날짜(YYYY-MM-DD)로 하루를 고른다. */
export async function selectDayByDate(page: Page, date: string) {
  const button = page.getByRole('navigation', { name: '날짜별 일정' }).locator(`button[data-date="${date}"]`);
  await expect(button, `날짜 ${date}`).toHaveCount(1);
  await button.click();
}

/** 현재 선택된 하루의 ISO 날짜. */
export async function currentDate(page: Page) {
  return page
    .getByRole('navigation', { name: '날짜별 일정' })
    .locator('[aria-current="date"]')
    .getAttribute('data-date');
}

/** 활동 카드(또는 페이지의 첫 활동 카드)의 `⋯` 메뉴를 열고 항목을 누른다. */
export async function menuAction(scope: Page | Locator, item: string) {
  await scope.locator('.menu-toggle').first().click();
  await scope.getByRole('button', { name: item, exact: true }).click();
}

/** 메뉴의 `일정에서 제거` → 확인 대화상자의 `제거 확인`. */
export async function removeActivity(scope: Page | Locator, page: Page) {
  await menuAction(scope, '일정에서 제거');
  await page.getByRole('dialog').getByRole('button', { name: '제거 확인', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}

/** 더보기 > 계획 버전 화면을 열고 계획 버전 선택 상자를 돌려준다. */
export async function planVersionSelect(page: Page) {
  await openMore(page, '계획 버전');
  return page.getByLabel('계획 버전');
}
