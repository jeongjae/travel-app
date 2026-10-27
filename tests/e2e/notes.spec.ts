import { expect, test, type Page } from '@playwright/test';

const workspace = '/?workspace=content&review=note-regression';
const note = '가상 검증용 메모 · 실제 방문 아님\n다음 실행에도 남아야 하는 두 번째 줄';

async function expand(page: Page, selector: string) {
  const details = page.locator(selector);
  if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await details.locator(':scope > summary').click();
  }
}

async function addSample(page: Page, short = false) {
  await expand(page, '.journey-library');
  await page.getByRole('button', { name: '가상 여행 둘러보기', exact: true }).click();
  await page
    .getByRole('button', { name: short ? '가상 미술 여행 B · 1일' : '가상 산책 여행 A · 3일', exact: true })
    .click();
  await page.getByRole('button', { name: '여행에 추가', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}

function firstStop(page: Page) {
  return page
    .locator('.timeline-stop')
    .filter({ has: page.getByRole('heading', { name: '가상 활동 1', exact: true }) });
}

async function saveNote(page: Page, body = note) {
  await firstStop(page).getByRole('button', { name: '메모', exact: true }).click();
  await page.getByLabel('메모 본문', { exact: true }).fill(body);
  await page.getByRole('button', { name: '메모 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('메모를 저장했습니다.', { exact: false })).toBeVisible();
}

test('활동 메모는 DB에 저장된 뒤 같은 메모 창과 일정에서 다시 보인다', async ({ page }) => {
  await page.goto(workspace);
  await addSample(page);
  await saveNote(page);
  const saved = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((accept, reject) => {
      const request = indexedDB.open('travel-app-review-note-regression');
      request.onsuccess = () => accept(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<{ kind: string; payload: { body?: string } }[]>((accept, reject) => {
        const request = database.transaction('field_records').objectStore('field_records').getAll();
        request.onsuccess = () => accept(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  });
  expect(saved.filter((record) => record.kind === 'note' && record.payload.body === note)).toHaveLength(1);
  await firstStop(page).getByRole('button', { name: '메모', exact: true }).click();
  await expect(page.getByRole('dialog').getByText(note, { exact: true })).toBeVisible();
  await expect(page.getByLabel('메모 본문')).toHaveValue('');
  await page.getByRole('dialog').getByRole('button', { name: '닫기', exact: true }).click();
  await expect(firstStop(page).getByText(note, { exact: true })).toBeVisible();
  await saveNote(page, '가상 두 번째 메모');
  await expect(firstStop(page).getByText(note, { exact: true })).toBeVisible();
  await expect(firstStop(page).getByText('가상 두 번째 메모', { exact: true })).toBeVisible();
  await firstStop(page).getByRole('button', { name: '메모', exact: true }).click();
  await page.screenshot({ path: test.info().outputPath('activity-note-history.png'), fullPage: false });
});

test('활동 제목과 계획이 바뀌어도 메모를 보존하고 다른 활동·여행과 분리한다', async ({ page }) => {
  await page.goto(workspace);
  await addSample(page);
  await saveNote(page);
  await page
    .locator('.timeline-stop')
    .filter({ has: page.getByRole('heading', { name: '가상 활동 2', exact: true }) })
    .getByRole('button', { name: '메모', exact: true })
    .click();
  await expect(page.getByRole('dialog').getByText(note, { exact: true })).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: '닫기', exact: true }).click();
  await firstStop(page).getByRole('button', { name: '일정 수정', exact: true }).click();
  await page.getByLabel('활동 제목').fill('새 계획의 가상 활동');
  await page.getByRole('button', { name: '계획 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const changed = page
    .locator('.timeline-stop')
    .filter({ has: page.getByRole('heading', { name: '새 계획의 가상 활동', exact: true }) });
  await expect(changed.getByText(note, { exact: true })).toBeVisible();
  await addSample(page, true);
  await expect(page.getByText(note, { exact: true })).toHaveCount(0);
  await expand(page, '.journey-library');
  await page
    .getByRole('navigation', { name: '여행 선택', exact: true })
    .getByRole('button', { name: '가상 산책 여행 A', exact: true })
    .click();
  await expect(changed.getByText(note, { exact: true })).toBeVisible();
});

test('오프라인 메모를 새 페이지·재로드·빈 공간 백업 복원 뒤 같은 활동에서 다시 읽는다', async ({
  page,
  context,
  browser,
}) => {
  await page.goto(workspace);
  await addSample(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await saveNote(page);
  const reopened = await context.newPage();
  await page.close();
  await reopened.goto(`http://127.0.0.1:4173${workspace}`);
  await expect(firstStop(reopened).getByText(note, { exact: true })).toBeVisible();
  await firstStop(reopened).getByRole('button', { name: '메모', exact: true }).click();
  await expect(reopened.getByRole('dialog').getByText(note, { exact: true })).toBeVisible();
  await reopened.getByRole('dialog').getByRole('button', { name: '닫기', exact: true }).click();
  await reopened.getByRole('button', { name: '저장소·백업', exact: true }).click();
  await reopened.getByRole('button', { name: '전체 백업 만들기', exact: true }).click();
  await expect(reopened.getByText('전체 백업 생성 완료', { exact: false })).toBeVisible();
  const download = reopened.waitForEvent('download');
  await reopened.getByRole('link', { name: '검증한 전체 백업 파일 저장', exact: true }).click();
  const path = test.info().outputPath('fictional-note-backup.zip');
  await (await download).saveAs(path);
  const restoredContext = await browser.newContext({
    viewport: reopened.viewportSize() ?? undefined,
    serviceWorkers: 'allow',
  });
  try {
    const restored = await restoredContext.newPage();
    await restored.goto('http://127.0.0.1:4173/?workspace=content&review=note-restored');
    await restored.getByRole('button', { name: '저장소·백업', exact: true }).click();
    await restored.getByLabel('전체 백업 파일 선택').setInputFiles(path);
    await restored.getByRole('button', { name: '확인 후 전체 복원', exact: true }).click();
    await expect(restored.getByText('전체 복원 완료.', { exact: false })).toBeVisible();
    await restored.getByRole('button', { name: '닫기', exact: true }).click();
    await restored.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await restored.reload();
    await expect.poll(() => restored.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await restoredContext.setOffline(true);
    await restored.reload();
    await expect(firstStop(restored).getByText(note, { exact: true })).toBeVisible();
    await firstStop(restored).getByRole('button', { name: '메모', exact: true }).click();
    await expect(restored.getByRole('dialog').getByText(note, { exact: true })).toBeVisible();
    await restored.screenshot({ path: test.info().outputPath('activity-note-restored.png'), fullPage: false });
  } finally {
    await restoredContext.close();
  }
});
