import { test, expect, type Page } from '@playwright/test';

/**
 * C-02: 숙박·이동 계획 편집. 가상 여행에서 생성→수정→제거→재조회→재실행→오프라인→복원을 desktop·mobile로 확인한다.
 * 기존 사용자 데이터·실제 ZIP은 쓰지 않는다.
 */
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

async function expand(page: Page, selector: string) {
  const details = page.locator(selector);
  if ((await details.getAttribute('open')) === null) {
    await details.locator(':scope > summary').click();
  }
}
async function openTab(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).first().click();
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
async function addRegion(page: Page, name: string) {
  await openTab(page, '가이드');
  await page.getByRole('button', { name: '지역 작성', exact: true }).click();
  await page.getByLabel('지역 이름').fill(name);
  await page.getByRole('button', { name: '지역 저장', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true, level: 2 })).toBeVisible();
}
async function addActivity(page: Page, title: string) {
  await openTab(page, '오늘');
  await page.getByRole('button', { name: '활동 추가', exact: true }).click();
  await page.getByLabel('활동 제목').fill(title);
  await page.getByRole('button', { name: '계획 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}
async function addStay(page: Page, name: string, region: string, checkin: string, checkout: string) {
  await openTab(page, '오늘');
  await page.getByRole('button', { name: '숙박 추가', exact: true }).click();
  await page.getByLabel('숙박 이름·거점').fill(name);
  await page.getByLabel('지역 (선택)').selectOption({ label: region });
  await page.getByLabel('입실 날짜').fill(checkin);
  await page.getByLabel('퇴실 날짜').fill(checkout);
}
async function saveStay(page: Page) {
  await page.getByRole('button', { name: '숙박 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}
async function selectDay(page: Page, date: string) {
  const select = page.getByLabel('날짜', { exact: true });
  const value = await select
    .locator('option')
    .evaluateAll((nodes, wanted) => nodes.find((n) => n.textContent?.startsWith(wanted))?.getAttribute('value'), date);
  expect(value).toBeTruthy();
  await select.selectOption(value!);
}
const regionLine = (page: Page) => page.locator('.stay-leg-editing .muted').first();

async function buildTrip(page: Page) {
  await page.goto('/?workspace=content');
  await createTrip(page, '가상 숙박 여행');
  await addRegion(page, '가상 동네');
  await addRegion(page, '가상 해변');
  await addActivity(page, '아침 산책');
  await addActivity(page, '점심 식사');
}

test('숙박·이동을 만들고 고치고 지우며, 하루 지역·야간 지역과 과거 계획이 기대대로 보인다', async ({ page }) => {
  await buildTrip(page);

  // 이동: 같은 날 두 활동 사이.
  await page.getByRole('button', { name: '이동 추가', exact: true }).click();
  await page.getByLabel('이동 수단').fill('도보');
  await page.getByLabel('소요 시간 (선택)').fill('15분');
  await page.getByRole('button', { name: '이동 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('이동 아침 산책 → 점심 식사 · 도보 · 15분', { exact: false })).toBeVisible();
  await expect(page.getByText('연결된 이동 1개', { exact: false }).first()).toBeVisible();

  // 숙박: 06-01~06-03, 미리보기가 날짜별 지역을 보여준다.
  await addStay(page, '가상 호텔', '가상 동네', '2032-06-01', '2032-06-03');
  await expect(page.getByRole('region', { name: '변경 요약' })).toContainText(
    '하루 지역 가상 동네 · 숙박 지역 가상 동네',
  );
  await saveStay(page);
  await expect(regionLine(page)).toContainText('하루 지역 가상 동네 · 밤을 보내는 지역 가상 동네');

  // 퇴실일(06-03)은 하루 지역에 포함되지만 밤을 보내는 지역은 없다.
  await selectDay(page, '2032-06-03');
  await expect(regionLine(page)).toContainText('하루 지역 가상 동네 · 밤을 보내는 지역 없음');
  await openTab(page, '전체 일정');
  await expect(page.getByText('지역 가상 동네 · 숙박 지역 가상 동네', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('이동 1개', { exact: false })).toBeVisible();

  // 재실행 뒤에도 같다.
  await page.reload();
  await openTab(page, '전체 일정');
  await expect(page.getByText('지역 가상 동네 · 숙박 지역 가상 동네', { exact: false }).first()).toBeVisible();

  // 수정: 기간을 줄이면 06-03에서 지역이 사라진다.
  await openTab(page, '오늘');
  await page.getByRole('button', { name: '가상 호텔 수정', exact: true }).click();
  await page.getByLabel('퇴실 날짜').fill('2032-06-02');
  await page.getByRole('button', { name: '숙박 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await selectDay(page, '2032-06-03');
  await expect(regionLine(page)).toContainText('하루 지역 없음 · 밤을 보내는 지역 없음');

  // 과거 계획은 읽기 전용으로 남아 이전 값을 보여준다.
  await expand(page, '.journey-extras');
  await expand(page, '.journey-settings');
  const options = await page.getByLabel('계획 버전').locator('option').allTextContents();
  const earlier = options.find((text) => text.includes('사용자 숙박 추가'));
  expect(earlier, options.join('|')).toBeTruthy();
  await page.getByLabel('계획 버전').selectOption({ label: earlier! });
  await expect(page.getByText('과거 계획', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: '숙박 추가', exact: true })).toBeDisabled();
  await selectDay(page, '2032-06-02');
  await expect(regionLine(page)).toContainText('하루 지역 가상 동네');
  await page.getByLabel('계획 버전').selectOption({ label: '현재 계획' });

  // 제거: 확인 단계 뒤에 지역 표시가 비워지고 활동은 그대로다.
  await selectDay(page, '2032-06-01');
  await page.getByRole('button', { name: '가상 호텔 수정', exact: true }).click();
  await page.getByRole('button', { name: '이 숙박 제거', exact: true }).click();
  await expect(page.getByText('아래 날짜의 지역 표시가 바뀝니다.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '제거 확인', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(regionLine(page)).toContainText('하루 지역 없음 · 밤을 보내는 지역 없음');
  await expect(page.locator('.day-timeline h3')).toHaveText(['아침 산책', '점심 식사']);

  // 이동 제거.
  await page.getByRole('button', { name: '이동 아침 산책 → 점심 식사 수정' }).click();
  await page.getByRole('button', { name: '이 이동 제거', exact: true }).click();
  await page.getByRole('button', { name: '제거 확인', exact: true }).click();
  await expect(page.getByText('이동 아침 산책 → 점심 식사', { exact: false })).toHaveCount(0);
});

test('겹친 밤은 저장을 막고 입력을 보존하며, 활동을 지우면 연결된 이동도 함께 사라진다', async ({ page }) => {
  await buildTrip(page);
  await addStay(page, '가상 호텔', '가상 동네', '2032-06-01', '2032-06-03');
  await saveStay(page);

  // 다른 지역이 같은 밤에 겹치면 미리보기에서 막히고 입력은 그대로다.
  await addStay(page, '가상 리조트', '가상 해변', '2032-06-02', '2032-06-03');
  await expect(page.getByRole('region', { name: '변경 요약' })).toContainText('겹칩니다');
  await expect(page.getByRole('button', { name: '숙박 저장', exact: true })).toBeDisabled();
  await expect(page.getByLabel('숙박 이름·거점')).toHaveValue('가상 리조트');
  await page.getByLabel('입실 날짜').fill('2032-06-03');
  await page.getByLabel('퇴실 날짜').fill('2032-06-03');
  await expect(page.getByRole('button', { name: '숙박 저장', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '닫기', exact: true }).click();

  // 이동이 있는 활동을 지우면 이동도 함께 지워지고 이전 계획에는 남는다.
  await openTab(page, '오늘');
  await page.getByRole('button', { name: '이동 추가', exact: true }).click();
  await page.getByLabel('이동 수단').fill('버스');
  await page.getByRole('button', { name: '이동 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('이동 아침 산책 → 점심 식사', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '일정에서 제거', exact: true }).first().click();
  await expect(page.getByText('이동 아침 산책 → 점심 식사', { exact: false })).toHaveCount(0);
  await expect(page.locator('.day-timeline h3')).toHaveText(['점심 식사']);
});

test('통신이 끊긴 상태에서도 숙박·이동을 저장하고 재실행 뒤에 읽는다', async ({ page, context }) => {
  await buildTrip(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForTimeout(400);
  await context.setOffline(true);
  await page.reload();
  await addStay(page, '오프라인 숙소', '가상 동네', '2032-06-01', '2032-06-02');
  await saveStay(page);
  await page.getByRole('button', { name: '이동 추가', exact: true }).click();
  await page.getByLabel('이동 수단').fill('택시');
  await page.getByRole('button', { name: '이동 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.reload();
  await expect(regionLine(page)).toContainText('하루 지역 가상 동네 · 밤을 보내는 지역 가상 동네');
  await expect(page.getByText('이동 아침 산책 → 점심 식사 · 택시', { exact: false })).toBeVisible();
});

test('숙박·이동이 든 두 여행을 전체 백업해 빈 브라우저에 복원하면 격리된 채 같은 내용을 읽는다', async ({
  page,
  browser,
}) => {
  await buildTrip(page);
  await addStay(page, '가상 호텔', '가상 동네', '2032-06-01', '2032-06-02');
  await saveStay(page);
  await page.getByRole('button', { name: '이동 추가', exact: true }).click();
  await page.getByLabel('이동 수단').fill('도보');
  await page.getByRole('button', { name: '이동 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await createTrip(page, '두 번째 가상 여행');
  await openTab(page, '오늘');
  await expect(page.getByText('연결된 이동', { exact: false })).toHaveCount(0);
  await expect(regionLine(page)).toContainText('하루 지역 없음');

  await page.getByRole('button', { name: '저장소·백업', exact: true }).click();
  await page.getByRole('button', { name: '전체 백업 만들기', exact: true }).click();
  await expect(page.getByText('전체 백업 생성 완료', { exact: false })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('link', { name: '검증한 전체 백업 파일 저장' }).click();
  const path = test.info().outputPath('stays-legs-backup.zip');
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
      .getByRole('button', { name: '가상 숙박 여행' })
      .click();
    await expect(restored.locator('.stay-leg-editing .muted').first()).toContainText(
      '하루 지역 가상 동네 · 밤을 보내는 지역 가상 동네',
    );
    await expect(restored.getByText('이동 아침 산책 → 점심 식사 · 도보', { exact: false })).toBeVisible();
    await restored
      .getByRole('navigation', { name: '여행 선택' })
      .getByRole('button', { name: '두 번째 가상 여행' })
      .click();
    await expect(restored.locator('.stay-leg-editing .muted').first()).toContainText('하루 지역 없음');
  } finally {
    await target.close();
  }
});
