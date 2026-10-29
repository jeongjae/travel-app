import { test, expect, type Page } from '@playwright/test';

/**
 * C-01: 지역 없는 새 여행 → 지역·장소와 설명 작성 → 일정 연결·순서/시간 수정 → 재실행 후 재조회.
 * 모두 가상 입력이며 기존 사용자 데이터를 쓰지 않는다. desktop·mobile 프로젝트에서 같은 흐름을 실행한다.
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

async function createTrip(page: Page, name: string, zone = '') {
  await expand(page, '.journey-library');
  await page.getByRole('button', { name: '새 여행', exact: true }).click();
  await page.getByLabel('여행 이름').fill(name);
  await page.getByLabel('시작 날짜').fill('2032-06-01');
  await page.getByLabel('종료 날짜').fill('2032-06-03');
  if (zone) {
    await page.getByLabel('시간대 (확인한 경우만)').fill(zone);
  }
  await page.getByRole('button', { name: '여행 만들기', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible();
}

async function openTab(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).first().click();
}

async function authorRegionAndPlace(page: Page) {
  await openTab(page, '가이드');
  await expect(page.getByText('아직 지역이나 장소가 없습니다.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '지역 작성', exact: true }).click();
  await page.getByLabel('지역 이름').fill('가상 지역');
  await page.getByLabel('지역 설명').fill('가상 지역의 소개 글');
  await page.getByRole('button', { name: '지역 저장', exact: true }).click();
  await expect(page.getByRole('heading', { name: '가상 지역', exact: true, level: 2 })).toBeVisible();
  await expect(page.getByText('가상 지역의 소개 글', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '목록으로', exact: true }).click();
  await page.getByRole('button', { name: '장소 작성', exact: true }).click();
  await page.getByLabel('장소 이름').fill('가상 카페');
  await page.getByLabel('한 줄 요약').fill('아침에 좋은 카페');
  await page.getByLabel('가상 지역').check();
  await page.getByLabel('왜 가는가 (필수)').fill('조용해서 첫 일정으로 좋다');
  await page.getByLabel('실용 정보').fill('오전 8시 개점');
  await page.getByRole('button', { name: '장소 저장', exact: true }).click();
  await expect(page.getByRole('heading', { name: '가상 카페', exact: true, level: 2 })).toBeVisible();
  await expect(page.getByText('조용해서 첫 일정으로 좋다', { exact: true })).toBeVisible();
  await expect(page.getByText('오전 8시 개점', { exact: true })).toBeVisible();
}

async function addActivity(page: Page, title: string, place?: string, time?: string) {
  await openTab(page, '오늘');
  await page.getByRole('button', { name: '활동 추가', exact: true }).click();
  if (place) {
    await page.getByLabel('연결할 장소').selectOption({ label: place });
  }
  if (title) {
    await page.getByLabel('활동 제목').fill(title);
  }
  if (time) {
    await page.getByLabel('시각 정밀도').selectOption('local');
    await page.getByLabel('발생 날짜').fill('2032-06-01');
    await page.locator('input[type=time]').fill(time);
  }
  await page.getByRole('button', { name: '계획 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}

const titles = (page: Page) => page.locator('.day-timeline h3').allTextContents();

test('새 여행→지역·장소 작성→일정 연결·순서 변경→재실행 뒤에도 같은 내용을 읽는다', async ({ page }) => {
  await page.goto('/?workspace=content');
  await createTrip(page, '가상 작성 여행', 'Europe/Paris');
  await openTab(page, '오늘');
  await expect(page.getByText('이 날에는 아직 일정이 없습니다.', { exact: false })).toBeVisible();
  await openTab(page, '전체 일정');
  await expect(page.locator('.journey-card')).toHaveCount(3);

  await authorRegionAndPlace(page);

  await addActivity(page, '', '가상 카페', '09:30');
  await addActivity(page, '가상 산책');
  await expect.poll(() => titles(page)).toEqual(['가상 카페', '가상 산책']);
  await page.getByRole('button', { name: '가상 산책 위로', exact: true }).click();
  await expect.poll(() => titles(page)).toEqual(['가상 산책', '가상 카페']);

  // 재실행 뒤 같은 순서·연결·본문을 다시 읽는다.
  await page.reload();
  await expect(page.getByRole('heading', { name: '가상 작성 여행', exact: true, level: 1 })).toBeVisible();
  await expect.poll(() => titles(page)).toEqual(['가상 산책', '가상 카페']);
  await page.getByRole('button', { name: /장소 안내 · 가상 카페/ }).click();
  await expect(page.getByRole('heading', { name: '가상 카페', exact: true, level: 2 })).toBeVisible();
  await expect(page.getByText('조용해서 첫 일정으로 좋다', { exact: true })).toBeVisible();

  // 가이드 목록에서도 검색으로 찾는다.
  await openTab(page, '가이드');
  await page.getByLabel('이름·지역 검색').fill('카페');
  await expect(page.getByRole('button', { name: '가상 카페', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '가상 지역', exact: true })).toHaveCount(0);
});

test('두 여행의 작성 내용은 섞이지 않고, 입력 오류는 입력을 보존한다', async ({ page }) => {
  await page.goto('/?workspace=content');
  await createTrip(page, '가상 작성 여행');
  await authorRegionAndPlace(page);
  await addActivity(page, '', '가상 카페');
  await createTrip(page, '두 번째 가상 여행');
  await openTab(page, '가이드');
  await expect(page.getByText('아직 지역이나 장소가 없습니다.', { exact: false })).toBeVisible();
  await openTab(page, '오늘');
  await expect(page.getByText('이 날에는 아직 일정이 없습니다.', { exact: false })).toBeVisible();

  // 필수 설명이 없으면 저장되지 않고 입력이 남는다.
  await openTab(page, '가이드');
  await page.getByRole('button', { name: '장소 작성', exact: true }).click();
  await page.getByLabel('장소 이름').fill('보존될 이름');
  await page.getByRole('button', { name: '장소 저장', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('왜 가는가');
  await expect(page.getByLabel('장소 이름')).toHaveValue('보존될 이름');
  await page.getByRole('button', { name: '닫기', exact: true }).click();

  await expand(page, '.journey-library');
  await page.getByRole('navigation', { name: '여행 선택' }).getByRole('button', { name: '가상 작성 여행' }).click();
  await openTab(page, '가이드');
  await expect(page.getByRole('button', { name: '가상 카페', exact: true })).toBeVisible();
  await openTab(page, '오늘');
  await expect.poll(() => titles(page)).toEqual(['가상 카페']);
});

test('작성한 여행을 전체 백업해 빈 브라우저에 복원하면 같은 내용을 다시 읽는다', async ({ page, browser }) => {
  await page.goto('/?workspace=content');
  await createTrip(page, '가상 작성 여행');
  await authorRegionAndPlace(page);
  await addActivity(page, '', '가상 카페', '10:00');
  await createTrip(page, '두 번째 가상 여행');
  await page.getByRole('button', { name: '저장소·백업', exact: true }).click();
  await page.getByRole('button', { name: '전체 백업 만들기', exact: true }).click();
  await expect(page.getByText('전체 백업 생성 완료', { exact: false })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('link', { name: '검증한 전체 백업 파일 저장' }).click();
  const file = await downloaded;
  const path = test.info().outputPath('authoring-backup.zip');
  await file.saveAs(path);

  const target = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  const restored = await target.newPage();
  const errors: string[] = [];
  restored.on('pageerror', (e) => errors.push(e.message));
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
    await expect(restored.getByRole('navigation', { name: '여행 선택' }).getByRole('button')).toHaveCount(2);
    await restored
      .getByRole('navigation', { name: '여행 선택' })
      .getByRole('button', { name: '가상 작성 여행' })
      .click();
    await expect.poll(() => titles(restored)).toEqual(['가상 카페']);
    await restored.getByRole('button', { name: /장소 안내 · 가상 카페/ }).click();
    await expect(restored.getByText('조용해서 첫 일정으로 좋다', { exact: true })).toBeVisible();
    await restored
      .getByRole('navigation', { name: '여행 선택' })
      .getByRole('button', { name: '두 번째 가상 여행' })
      .click();
    await openTab(restored, '가이드');
    await expect(restored.getByText('아직 지역이나 장소가 없습니다.', { exact: false })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await target.close();
  }
});
