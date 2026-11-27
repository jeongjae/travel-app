import { test, expect } from '@playwright/test';
import { openTripMenu } from './helpers/nav';

/** T-E3-2b R0: 짧은 날짜의 마지막 활동 카드 `⋯` 메뉴는 하단 탭 줄에 가리지 않고 항목을 누를 수 있다. 가상 자료만 쓴다. */
test('mobile: 짧은 날짜의 마지막 카드 ⋯ 메뉴가 하단 탭 줄 위에 열리고 항목을 누를 수 있다', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', '하단 탭 줄이 있는 모바일 폭에서만 확인한다');
  await page.goto('/?workspace=content');
  await openTripMenu(page);
  await page.getByRole('button', { name: '새 여행', exact: true }).click();
  await page.getByLabel('여행 이름').fill('메뉴 확인 가상 여행');
  await page.getByLabel('시작 날짜').fill('2032-07-01');
  await page.getByLabel('종료 날짜').fill('2032-07-02');
  await page.getByRole('button', { name: '여행 만들기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '메뉴 확인 가상 여행', exact: true, level: 1 })).toBeVisible();
  await page.getByRole('button', { name: '활동 추가', exact: true }).click();
  await page.getByLabel('활동 제목').fill('마지막 가상 활동');
  await page.getByRole('button', { name: '계획 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();

  const card = page.locator('article.timeline-stop').filter({ hasText: '마지막 가상 활동' });
  await card.locator('.menu-toggle').click();
  const panel = card.locator('.action-menu-panel');
  await expect(panel).toBeVisible();
  const navTop = (await page.getByRole('navigation', { name: '주요 메뉴' }).boundingBox())!.y;
  const panelBox = (await panel.boundingBox())!;
  expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(navTop);
  expect(panelBox.y).toBeGreaterThanOrEqual(0);
  // 일반 클릭(가림 검사 포함)으로 누를 수 있어야 한다.
  await panel.getByRole('button', { name: '일정 수정', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
