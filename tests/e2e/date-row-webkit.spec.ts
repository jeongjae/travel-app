import { test, expect, devices } from '@playwright/test';
import { openTripMenu } from './helpers/nav';

/** T-P1 R3: iPhone(WebKit)에서 "AI로 계획 만들기"의 시작·종료 날짜 칸이 서로 겹치거나 대화상자 밖으로 나가지 않는다. */
const CAPTURE = process.env.R3_CAPTURE;

for (const width of [390, 360, 320]) {
  test(`iPhone WebKit ${width}px: 시작·종료 날짜 칸이 겹치지 않고 대화상자 폭을 넘지 않는다`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/?workspace=content');
    await openTripMenu(page);
    await page.getByRole('button', { name: 'AI로 계획 만들기', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const start = dialog.getByLabel('시작 날짜');
    const end = dialog.getByLabel('종료 날짜');
    await start.scrollIntoViewIfNeeded();
    const [dialogBox, startBox, endBox] = await Promise.all([
      dialog.boundingBox(),
      start.boundingBox(),
      end.boundingBox(),
    ]);
    expect(dialogBox && startBox && endBox).toBeTruthy();
    const dialogRight = dialogBox!.x + dialogBox!.width;
    for (const box of [startBox!, endBox!]) {
      expect(box.x).toBeGreaterThanOrEqual(dialogBox!.x);
      expect(box.x + box.width).toBeLessThanOrEqual(dialogRight + 0.5);
    }
    const overlapsHorizontally = startBox!.x < endBox!.x + endBox!.width && endBox!.x < startBox!.x + startBox!.width;
    const overlapsVertically = startBox!.y < endBox!.y + endBox!.height && endBox!.y < startBox!.y + startBox!.height;
    expect(overlapsHorizontally && overlapsVertically).toBe(false);
    if (CAPTURE && width === 390) {
      await dialog.screenshot({ path: CAPTURE });
    }
  });
}

test.use({ ...devices['iPhone 13'] });
