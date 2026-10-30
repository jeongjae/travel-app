import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * C-04: 현장 기록(방문/건너뜀/예정 외 활동)의 장소 연결, 추가식 정정, 당시 맥락 재조회.
 * 가상 여행에서 기록→찾기→열기→정정 전후→재실행→오프라인→복원을 desktop·mobile로 확인한다.
 * 기존 사용자 데이터·실제 ZIP은 쓰지 않는다.
 */
let browserErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  browserErrors = [];
  page.on('pageerror', (e) => browserErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('409')) {
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

async function expand(page: Page, selector: string) {
  const details = page.locator(selector);
  if ((await details.getAttribute('open')) === null) {
    await details.locator(':scope > summary').click();
  }
}
async function openTab(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).first().click();
}
async function openRecords(page: Page) {
  await expand(page, '.journey-extras');
  await page.getByRole('button', { name: '실제 기록', exact: true }).click();
}
async function createTrip(page: Page, name: string) {
  await expand(page, '.journey-library');
  await page.getByRole('button', { name: '새 여행', exact: true }).click();
  await page.getByLabel('여행 이름').fill(name);
  await page.getByLabel('시작 날짜').fill('2032-06-01');
  await page.getByLabel('종료 날짜').fill('2032-06-03');
  await page.getByRole('button', { name: '여행 만들기', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible();
}
async function addRegionAndPlace(page: Page, placeName: string) {
  await openTab(page, '가이드');
  await page.getByRole('button', { name: '지역 작성', exact: true }).click();
  await page.getByLabel('지역 이름').fill('가상 지역');
  await page.getByRole('button', { name: '지역 저장', exact: true }).click();
  await expect(page.getByRole('heading', { name: '가상 지역', exact: true, level: 2 })).toBeVisible();
  await page.getByRole('button', { name: '목록으로', exact: true }).click();
  await addPlace(page, placeName);
}
async function addPlace(page: Page, name: string) {
  await page.getByRole('button', { name: '장소 작성', exact: true }).click();
  await page.getByLabel('장소 이름').fill(name);
  await page.getByLabel('한 줄 요약').fill('처음 요약');
  await page.getByLabel('가상 지역').check();
  await page.getByLabel('왜 가는가 (필수)').fill('당시 이유');
  await page.getByRole('button', { name: '장소 저장', exact: true }).click();
}
async function record(page: Page, title: string, options: { place?: string; note?: string } = {}) {
  await page.getByRole('button', { name: '예정 외 활동 기록', exact: true }).click();
  await page.getByLabel('활동 이름').fill(title);
  if (options.place) {
    await page.getByLabel('기록할 장소').selectOption({ label: options.place });
  }
  if (options.note) {
    await page.getByLabel('기록 메모').fill(options.note);
  }
  await page.getByRole('button', { name: '실제 기록 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}
const row = (page: Page, title: string): Locator => page.locator('article.content-row', { hasText: title });
async function correctNote(page: Page, title: string, note: string) {
  await row(page, title).getByRole('button', { name: '정정', exact: true }).click();
  await page.getByLabel('기록 메모').fill(note);
  await page.getByRole('button', { name: '실제 기록 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}

test('장소를 고른 기록·장소 없는 기록을 남기고 이름이 바뀐 뒤에도 당시 내용으로 읽으며 두 번 정정한다', async ({
  page,
}) => {
  await page.goto('/?workspace=content');
  await createTrip(page, '가상 현장 여행');
  await addRegionAndPlace(page, '가상 카페');

  await openRecords(page);
  await record(page, '우연히 들른 카페', { place: '가상 카페', note: '처음 메모' });
  await record(page, '길가의 벤치', { note: '장소 없이 남김' });
  await expect(row(page, '우연히 들른 카페').getByText('장소 · 가상 카페 (기록 당시 이름)')).toBeVisible();
  await expect(row(page, '길가의 벤치').getByText('장소 ·', { exact: false })).toHaveCount(0);
  await expect(row(page, '길가의 벤치').getByRole('button', { name: '기록 당시 내용', exact: true })).toBeVisible();
  // 장소 없는 기록의 당시 내용은 안내만 보이고 아무것도 이동하지 않는다.
  await row(page, '길가의 벤치').getByRole('button', { name: '기록 당시 내용', exact: true }).click();
  await expect(page.getByText('이 기록에는 연결된 장소 본문이 없습니다.', { exact: false })).toBeVisible();

  // 계획은 바뀌지 않고, 예정 외 기록이 일정 항목을 만들지 않는다.
  await openTab(page, '오늘');
  await expect(page.getByText('이 날에는 아직 일정이 없습니다.', { exact: false })).toBeVisible();

  // 장소 이름과 요약을 바꾼다.
  await openTab(page, '가이드');
  await page.getByRole('button', { name: '가상 카페', exact: true }).click();
  await page.getByRole('button', { name: '기본정보 수정', exact: true }).click();
  await page.getByLabel('장소 이름').fill('새 카페 이름');
  await page.getByLabel('한 줄 요약').fill('바뀐 요약');
  await page.getByRole('button', { name: '기본정보 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();

  await openRecords(page);
  await expect(row(page, '우연히 들른 카페').getByText('장소 · 가상 카페 (기록 당시 이름)')).toBeVisible();
  await row(page, '우연히 들른 카페').getByRole('button', { name: '기록 당시 내용', exact: true }).click();
  await expect(page.getByText('당시 고정 내용', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '가상 카페', exact: true, level: 2 })).toBeVisible();
  await expect(page.getByText('처음 요약', { exact: true })).toBeVisible();
  await expect(page.getByText('바뀐 요약', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '실제 기록으로 돌아가기', exact: true }).click();

  // 메모만 두 번 정정한다. 원본과 이전 정정은 남고, 장소·당시 이름은 그대로다.
  await correctNote(page, '우연히 들른 카페', '두 번째 메모');
  await expect(page.getByText('정정된 기록 · 원본 보존')).toHaveCount(1);
  const latest = page.locator('article.content-row', { hasText: '두 번째 메모' });
  await latest.getByRole('button', { name: '정정', exact: true }).click();
  await page.getByLabel('기록 메모').fill('세 번째 메모');
  await page.getByRole('button', { name: '실제 기록 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('정정된 기록 · 원본 보존')).toHaveCount(2);
  await expect(page.getByText('정정 3/3단계 · 최신 정정본', { exact: false })).toBeVisible();
  await expect(page.getByText('정정 1/3단계 · 이후 정정본 있음', { exact: false })).toBeVisible();
  await expect(page.getByText('처음 메모', { exact: true })).toBeVisible();
  await expect(page.getByText('세 번째 메모', { exact: true })).toBeVisible();
  await expect(page.getByText('장소 · 가상 카페 (기록 당시 이름)')).toHaveCount(3);

  // 재실행 뒤에도 같다.
  await page.reload();
  await openRecords(page);
  await expect(page.getByText('정정 3/3단계 · 최신 정정본', { exact: false })).toBeVisible();
  await expect(page.getByText('장소 · 가상 카페 (기록 당시 이름)')).toHaveCount(3);
  await expect(page.getByText('처음 메모', { exact: true })).toBeVisible();
});

test('새 장소를 먼저 저장하면 쓰던 기록 입력이 남고 그 장소를 골라 저장한다', async ({ page }) => {
  await page.goto('/?workspace=content');
  await createTrip(page, '가상 현장 여행');
  await openRecords(page);
  await page.getByRole('button', { name: '예정 외 활동 기록', exact: true }).click();
  await expect(page.getByLabel('기록할 장소')).toBeVisible();
  await expect(page.getByLabel('기록할 장소').locator('option')).toHaveText(['장소 없음']);
  await page.getByLabel('활동 이름').fill('새로 알게 된 가게');
  await page.getByLabel('기록 메모').fill('입력은 그대로 남아야 한다');
  await page.getByRole('button', { name: '새 장소 먼저 저장', exact: true }).click();

  // 기록 폼은 닫히고 장소 작성 화면이 열린다. 장소 저장은 별개의 저장이다.
  await expect(page.getByRole('heading', { name: '장소 작성' })).toBeVisible();
  await page.getByLabel('장소 이름').fill('새 가게');
  await page.getByLabel('왜 가는가 (필수)').fill('우연히 발견');
  await page.getByRole('button', { name: '장소 저장', exact: true }).click();

  // 장소가 저장된 뒤 기록 폼으로 돌아와 입력과 새 장소 선택이 이어진다.
  await expect(page.getByRole('heading', { name: '실제 활동 기록' })).toBeVisible();
  await expect(page.getByLabel('활동 이름')).toHaveValue('새로 알게 된 가게');
  await expect(page.getByLabel('기록 메모')).toHaveValue('입력은 그대로 남아야 한다');
  await page.getByLabel('기록할 장소').selectOption({ label: '새 가게' });
  await page.getByRole('button', { name: '실제 기록 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await openRecords(page);
  await expect(row(page, '새로 알게 된 가게').getByText('장소 · 새 가게 (기록 당시 이름)')).toBeVisible();

  // 장소 작성을 닫으면 기록 입력으로 돌아온다. 저장된 장소는 없다.
  await page.getByRole('button', { name: '예정 외 활동 기록', exact: true }).click();
  await page.getByLabel('활동 이름').fill('취소하는 기록');
  await page.getByRole('button', { name: '새 장소 먼저 저장', exact: true }).click();
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(page.getByLabel('활동 이름')).toHaveValue('취소하는 기록');
});

test('일정의 방문·건너뜀 기록과 메모는 계획과 분리되어 남고 계획을 바꿔도 읽는다', async ({ page }) => {
  await page.goto('/?workspace=content');
  await createTrip(page, '가상 현장 여행');
  await openTab(page, '오늘');
  await page.getByRole('button', { name: '활동 추가', exact: true }).click();
  await page.getByLabel('활동 제목').fill('가상 산책');
  await page.getByRole('button', { name: '계획 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();

  await page.getByRole('button', { name: '건너뜀 기록', exact: true }).first().click();
  await page.getByLabel('기록 메모').fill('비가 와서 건너뜀');
  await page.getByRole('button', { name: '실제 기록 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: '일정에서 제거', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: '가상 산책', exact: true })).toHaveCount(0);

  await openRecords(page);
  await expect(row(page, '가상 산책').getByText('건너뜀', { exact: false }).first()).toBeVisible();
  await expect(row(page, '가상 산책').getByText('비가 와서 건너뜀')).toBeVisible();
  // 일정 항목에 연결된 기록에는 장소 선택이 없고, 정정해도 계획 연결과 메모 외 값을 그대로 둔다.
  await correctNote(page, '가상 산책', '비 때문에 건너뜀 (정정)');
  await expect(page.getByText('정정 2/2단계 · 최신 정정본', { exact: false })).toBeVisible();
  await row(page, '가상 산책')
    .filter({ hasText: '정정 2/2단계' })
    .getByRole('button', { name: '정정', exact: true })
    .click();
  await expect(page.getByLabel('기록할 장소')).toHaveCount(0);
  await page.getByRole('button', { name: '닫기', exact: true }).click();

  // 여행 메모는 따로 저장되어 다시 열어도 남는다.
  await page.getByRole('button', { name: '여행 메모 쓰기', exact: true }).click();
  await page.getByLabel('메모 본문').fill('현장에서 남긴 여행 메모');
  await page.getByRole('button', { name: '메모 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.reload();
  await openRecords(page);
  await expect(page.getByText('현장에서 남긴 여행 메모', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '여행 메모 쓰기', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('현장에서 남긴 여행 메모', { exact: true })).toBeVisible();
});

test('다른 탭이 먼저 기록하면 오래된 정정 폼은 입력을 남기고 충돌을 알린다', async ({ page, context }) => {
  await page.goto('/?workspace=content');
  await createTrip(page, '가상 현장 여행');
  await openRecords(page);
  await record(page, '기준 기록', { note: '처음' });
  await row(page, '기준 기록').getByRole('button', { name: '정정', exact: true }).click();
  await page.getByLabel('기록 메모').fill('오래된 폼에서 쓴 정정');

  const other = await context.newPage();
  await other.goto('/?workspace=content');
  await openRecords(other);
  await record(other, '다른 탭의 기록');

  await page.getByRole('button', { name: '실제 기록 저장', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('다른 변경이 저장되었습니다');
  await expect(page.getByText('입력한 내용은 그대로 남아 있습니다.', { exact: false })).toBeVisible();
  await expect(page.getByLabel('기록 메모')).toHaveValue('오래된 폼에서 쓴 정정');
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.reload();
  await openRecords(page);
  // 원문은 정정되지 않은 채 남고 다른 탭의 기록도 보인다.
  await expect(page.getByText('정정된 기록 · 원본 보존')).toHaveCount(0);
  await expect(row(page, '다른 탭의 기록')).toBeVisible();
  await correctNote(page, '기준 기록', '최신 상태에서 다시 쓴 정정');
  await expect(page.getByText('정정된 기록 · 원본 보존')).toHaveCount(1);
});

test('통신이 끊긴 상태에서도 기록·메모·정정을 저장하고 재실행 뒤 읽는다', async ({ page, context }) => {
  await page.goto('/?workspace=content');
  await createTrip(page, '가상 현장 여행');
  await addRegionAndPlace(page, '가상 카페');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForTimeout(400);
  await context.setOffline(true);
  await page.reload();
  await openRecords(page);
  await record(page, '오프라인 기록', { place: '가상 카페', note: '오프라인 처음' });
  await correctNote(page, '오프라인 기록', '오프라인 정정');
  await page.getByRole('button', { name: '여행 메모 쓰기', exact: true }).click();
  await page.getByLabel('메모 본문').fill('오프라인 메모');
  await page.getByRole('button', { name: '메모 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.reload();
  await openRecords(page);
  await expect(page.getByText('오프라인 처음', { exact: true })).toBeVisible();
  await expect(page.getByText('오프라인 정정', { exact: true })).toBeVisible();
  await expect(page.getByText('정정 2/2단계 · 최신 정정본', { exact: false })).toBeVisible();
  await expect(page.getByText('오프라인 메모', { exact: true })).toBeVisible();
  await expect(page.getByText('장소 · 가상 카페 (기록 당시 이름)')).toHaveCount(2);
});

test('정정이 든 두 여행을 전체 백업해 빈 브라우저에 복원하면 원문·최신·당시 장소를 같게 읽는다', async ({
  page,
  browser,
}) => {
  await page.goto('/?workspace=content');
  await createTrip(page, '가상 현장 여행');
  await addRegionAndPlace(page, '가상 카페');
  await openRecords(page);
  await record(page, '복원할 기록', { place: '가상 카페', note: '복원 전 원문' });
  await correctNote(page, '복원할 기록', '복원 전 정정');
  await openTab(page, '가이드');
  await page.getByRole('button', { name: '가상 카페', exact: true }).click();
  await page.getByRole('button', { name: '기본정보 수정', exact: true }).click();
  await page.getByLabel('장소 이름').fill('바뀐 카페');
  await page.getByRole('button', { name: '기본정보 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await createTrip(page, '두 번째 가상 여행');
  await openRecords(page);
  await expect(page.getByText('실제 기록이 없습니다.')).toBeVisible();

  await page.getByRole('button', { name: '저장소·백업', exact: true }).click();
  await page.getByRole('button', { name: '전체 백업 만들기', exact: true }).click();
  await expect(page.getByText('전체 백업 생성 완료', { exact: false })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('link', { name: '검증한 전체 백업 파일 저장' }).click();
  const path = test.info().outputPath('field-backup.zip');
  await (await downloaded).saveAs(path);

  const target = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  const restored = await target.newPage();
  try {
    await restored.goto('http://127.0.0.1:4173/?workspace=content');
    await restored.getByRole('button', { name: '저장소·백업', exact: true }).click();
    await restored.getByLabel('전체 백업 파일 선택').setInputFiles(path);
    await expect(restored.getByText('복원 미리보기: 2개 여행', { exact: false })).toBeVisible();
    await restored.getByRole('button', { name: '확인 후 전체 복원', exact: true }).click();
    await expect(restored.getByText('전체 복원 완료.', { exact: false })).toBeVisible();
    await restored.getByRole('button', { name: '닫기', exact: true }).click();
    await restored.reload();
    await expand(restored, '.journey-library');
    await restored
      .getByRole('navigation', { name: '여행 선택' })
      .getByRole('button', { name: '가상 현장 여행' })
      .click();
    await openRecords(restored);
    await expect(restored.getByText('복원 전 원문', { exact: true })).toBeVisible();
    await expect(restored.getByText('복원 전 정정', { exact: true })).toBeVisible();
    await expect(restored.getByText('정정 2/2단계 · 최신 정정본', { exact: false })).toBeVisible();
    await expect(restored.getByText('장소 · 가상 카페 (기록 당시 이름)')).toHaveCount(2);
    await restored
      .locator('article.content-row', { hasText: '복원 전 정정' })
      .getByRole('button', { name: '기록 당시 내용', exact: true })
      .click();
    await expect(restored.getByText('당시 고정 내용', { exact: true })).toBeVisible();
    await expect(restored.getByRole('heading', { name: '가상 카페', exact: true, level: 2 })).toBeVisible();
    await expand(restored, '.journey-library');
    await restored
      .getByRole('navigation', { name: '여행 선택' })
      .getByRole('button', { name: '두 번째 가상 여행' })
      .click();
    await openRecords(restored);
    await expect(restored.getByText('실제 기록이 없습니다.')).toBeVisible();
  } finally {
    await target.close();
  }
});
