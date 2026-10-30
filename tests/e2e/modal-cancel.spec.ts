import { test, expect } from '@playwright/test';

/**
 * CL-16: 파일 입력의 cancel 이벤트가 거품처럼 올라와도 공통 대화상자는 닫히지 않아야 한다.
 * 대화상자 자신의 취소(Esc)는 계속 닫는다.
 */
test('저장소·백업에서 파일 선택 취소는 대화상자를 닫지 않고 Esc는 닫는다', async ({ page }) => {
  await page.route('**/api/ai/v2/status', (route) => route.fulfill({ json: { configured: false } }));
  await page.goto('/?workspace=content&review=modal-cancel-' + test.info().project.name);
  await page.getByRole('button', { name: '저장소·백업', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // 브라우저가 파일 선택 창 취소 때 발생시키는 것과 같은, 거품이 올라가는 cancel 이벤트.
  await page.getByLabel('전체 백업 파일 선택').evaluate((input) => {
    input.dispatchEvent(new Event('cancel', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  await expect(dialog).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});
