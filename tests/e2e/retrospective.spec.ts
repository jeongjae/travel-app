import { test, expect, type Page } from '@playwright/test';

/**
 * C-05: 날짜별 회고(읽기 전용). 가상 여행에서 계획→기록·정정→계획/장소 변경→회고 날짜 선택→
 * 당시 계획·실제·원문·이유·당시 본문→회고 복귀, 재실행·오프라인·두 여행 전체 백업 복원 뒤 같은 회고를 확인한다.
 * 기존 사용자 데이터·실제 ZIP은 쓰지 않는다.
 */
let browserErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  browserErrors = [];
  // 변경안 화면의 AI 상태 조회는 시험에서 사용하지 않는 것으로 고정한다. 실제 AI 호출은 없다.
  await page.route('**/api/ai/v2/status', (route) => route.fulfill({ json: { configured: false } }));
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
async function openExtra(page: Page, name: string) {
  await expand(page, '.journey-extras');
  await page.getByRole('button', { name, exact: true }).click();
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
  await page.getByRole('button', { name: '장소 작성', exact: true }).click();
  await page.getByLabel('장소 이름').fill(placeName);
  await page.getByLabel('한 줄 요약').fill('처음 요약');
  await page.getByLabel('가상 지역').check();
  await page.getByLabel('왜 가는가 (필수)').fill('당시 이유');
  await page.getByRole('button', { name: '장소 저장', exact: true }).click();
}
async function addActivity(page: Page, title: string) {
  await page.getByRole('button', { name: '활동 추가', exact: true }).click();
  await page.getByLabel('활동 제목').fill(title);
  await page.getByRole('button', { name: '계획 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}
async function recordUnplanned(page: Page, title: string, options: { place?: string; date?: string; note?: string }) {
  await page.getByRole('button', { name: '예정 외 활동 기록', exact: true }).click();
  await page.getByLabel('활동 이름').fill(title);
  if (options.place) {
    await page.getByLabel('기록할 장소').selectOption({ label: options.place });
  }
  if (options.date) {
    await page.getByLabel('시각 정밀도').selectOption({ label: '날짜만 확인' });
    await page.getByLabel('발생 날짜').fill(options.date);
  }
  if (options.note) {
    await page.getByLabel('기록 메모').fill(options.note);
  }
  await page.getByRole('button', { name: '실제 기록 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}
async function correctLatest(page: Page, title: string, edit: { date?: string; note?: string }) {
  await page
    .locator('article.content-row', { hasText: title })
    .getByRole('button', { name: '정정', exact: true })
    .click();
  if (edit.date) {
    await page.getByLabel('발생 날짜').fill(edit.date);
  }
  if (edit.note) {
    await page.getByLabel('기록 메모').fill(edit.note);
  }
  await page.getByRole('button', { name: '실제 기록 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}
const revisionText = (page: Page) => page.locator('.journey-settings .version-controls .muted').textContent();

/** 계획 1~5(활동 추가 2, 제거, 변경안 적용), 날짜 이동 정정, 날짜 미상 건너뜀을 만든다. */
async function buildScenario(page: Page) {
  await createTrip(page, '가상 회고 여행');
  await addRegionAndPlace(page, '가상 카페');
  await openTab(page, '오늘');
  await addActivity(page, '가상 산책');
  await addActivity(page, '가상 식사');
  await page.getByRole('button', { name: '건너뜀 기록', exact: true }).first().click();
  await page.getByLabel('기록 메모').fill('비가 와서 건너뜀');
  await page.getByRole('button', { name: '실제 기록 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: '일정에서 제거', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: '가상 산책', exact: true })).toHaveCount(0);
  await openExtra(page, '변경안');
  await page.getByRole('button', { name: '모의 변경안 만들기', exact: true }).click();
  await page.getByRole('button', { name: '미적용 초안 저장', exact: true }).click();
  await page.getByRole('button', { name: '확인 후 적용', exact: true }).click();
  await expect(page.getByText('적용됨', { exact: false }).first()).toBeVisible();
  await openExtra(page, '실제 기록');
  await recordUnplanned(page, '우연한 카페', { place: '가상 카페', date: '2032-06-01', note: '처음 메모' });
  await correctLatest(page, '우연한 카페', { date: '2032-06-02' });
  await correctLatest(page, '우연한 카페', { note: '둘째 정정 메모' });
  await recordUnplanned(page, '날짜 모르는 활동', { note: '날짜 미상 메모' });
  // 장소 이름과 요약을 바꾼다. 회고는 기록 당시 내용을 읽어야 한다.
  await openTab(page, '가이드');
  await page.getByRole('button', { name: '가상 카페', exact: true }).click();
  await page.getByRole('button', { name: '기본정보 수정', exact: true }).click();
  await page.getByLabel('장소 이름').fill('새 카페 이름');
  await page.getByLabel('한 줄 요약').fill('바뀐 요약');
  await page.getByRole('button', { name: '기본정보 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}
async function openRetro(page: Page) {
  await openExtra(page, '실제 기록');
  await page.getByRole('button', { name: '날짜별 회고 보기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '날짜별 회고', exact: true })).toBeVisible();
}
async function expectRetroContent(page: Page) {
  const retro = page.getByRole('region', { name: '날짜별 회고' });
  // 5/2: 정정으로 옮겨 온 최신 정정본이 대표이고 원문 단계를 이어 읽는다.
  await retro.getByLabel('회고 날짜').selectOption('2032-06-02');
  await expect(retro.getByRole('heading', { name: '우연한 카페', level: 4 })).toBeVisible();
  await expect(retro.getByText('정정으로 날짜가 바뀐 기록 · 앞선 단계의 날짜: 2032-06-01')).toBeVisible();
  await retro.getByText('정정 3단계 원문 보기').click();
  await expect(retro.getByText('원본 · 우연한 카페', { exact: false })).toBeVisible();
  await expect(retro.getByText('최신 정정본 · 우연한 카페', { exact: false })).toBeVisible();
  // 6/1: 원문을 이 날짜로 기록했지만 정정으로 옮겨졌음을 알려 준다.
  await retro.getByLabel('회고 날짜').selectOption('2032-06-01');
  await expect(retro.getByText('정정으로 2032-06-02(으)로 옮긴 기록입니다.', { exact: false })).toBeVisible();
  // 날짜 미상: 건너뜀(계획 연결)과 예정 외 활동(계획 연결 없음)을 따로 모은다.
  await retro.getByLabel('회고 날짜').selectOption('unknown');
  await expect(retro.getByRole('heading', { name: '날짜 미상 실제 기록' })).toBeVisible();
  await expect(retro.getByText('날짜를 알 수 없는 기록입니다.', { exact: false })).toBeVisible();
  await expect(retro.getByText('비가 와서 건너뜀')).toBeVisible();
  await expect(retro.getByText('현재 계획에서는 제거됨', { exact: false })).toBeVisible();
  await expect(retro.getByText('계획 연결 없음', { exact: false })).toBeVisible();
}

test('날짜별 회고에서 당시 계획·정정 원문·변경 이유·당시 본문을 읽고 같은 회고로 돌아온다', async ({ page }) => {
  await page.goto('/?workspace=content');
  await buildScenario(page);
  await openExtra(page, '실제 기록');
  const before = await revisionText(page);
  await openRetro(page);
  await expectRetroContent(page);

  // 선택한 과거 계획과 현재 계획을 열로 나눠 보고 변경 이유를 읽는다.
  const retro = page.getByRole('region', { name: '날짜별 회고' });
  await retro.getByLabel('회고 날짜').selectOption('2032-06-01');
  await retro.getByLabel('회고 계획 버전').selectOption({ label: '과거 계획 2 · 사용자 일정 수정' });
  await expect(
    retro.getByRole('article', { name: '과거 계획 2' }).getByText('가상 산책', { exact: false }),
  ).toBeVisible();
  await expect(retro.getByRole('article', { name: '과거 계획 2' }).getByText('가상 식사')).toHaveCount(0);
  await expect(
    retro.getByRole('article', { name: '현재 계획 5' }).getByText('가상 식사', { exact: false }),
  ).toBeVisible();
  await expect(retro.getByRole('article', { name: '현재 계획 5' }).getByText('가상 산책')).toHaveCount(0);
  await expect(retro.getByRole('article', { name: '계획 5 변경 이유' }).getByText('가상 상황에 따른 변경')).toHaveCount(
    2,
  );
  await expect(retro.getByText('근거 없음', { exact: false }).first()).toBeVisible();
  await expect(
    retro.getByRole('article', { name: '계획 2 변경 이유' }).getByText('변경안 없음', { exact: false }),
  ).toBeVisible();

  // 날짜 미상 기록의 당시 장소 본문을 열었다가 같은 날짜·버전의 회고로 돌아온다.
  await retro.getByLabel('회고 날짜').selectOption('2032-06-02');
  await retro.getByRole('button', { name: '기록 당시 내용', exact: true }).click();
  await expect(page.getByText('당시 고정 내용', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '가상 카페', exact: true, level: 2 })).toBeVisible();
  await expect(page.getByText('처음 요약', { exact: true })).toBeVisible();
  await expect(page.getByText('바뀐 요약', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /수정|본문 저장|정정/ })).toHaveCount(0);
  await page.getByRole('button', { name: '실제 기록으로 돌아가기', exact: true }).click();
  await expect(page.getByRole('region', { name: '날짜별 회고' }).getByLabel('회고 날짜')).toHaveValue('2032-06-02');

  // 조회만으로 저장소 revision이 바뀌지 않는다.
  await openExtra(page, '실제 기록');
  expect(await revisionText(page)).toBe(before);

  // 재실행 뒤에도 같다.
  await page.reload();
  await openRetro(page);
  await expectRetroContent(page);
});

test('통신이 끊긴 상태에서도 재실행 뒤 날짜별 회고를 읽는다', async ({ page, context }) => {
  await page.goto('/?workspace=content');
  await createTrip(page, '가상 회고 여행');
  await addRegionAndPlace(page, '가상 카페');
  await openExtra(page, '실제 기록');
  await recordUnplanned(page, '오프라인 활동', { place: '가상 카페', date: '2032-06-01', note: '오프라인 메모' });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForTimeout(400);
  await context.setOffline(true);
  await page.reload();
  await openRetro(page);
  const retro = page.getByRole('region', { name: '날짜별 회고' });
  await retro.getByLabel('회고 날짜').selectOption('2032-06-01');
  await expect(retro.getByRole('heading', { name: '오프라인 활동', level: 4 })).toBeVisible();
  await expect(retro.getByText('계획 연결 없음', { exact: false })).toBeVisible();
  await expect(
    retro.getByRole('article', { name: '계획 1 변경 이유' }).getByText('변경안 없음', { exact: false }),
  ).toBeVisible();
});

test('두 여행을 전체 백업해 빈 브라우저에 복원하면 같은 회고를 읽고 여행 간 섞이지 않는다', async ({
  page,
  browser,
}) => {
  await page.goto('/?workspace=content');
  await buildScenario(page);
  await createTrip(page, '두 번째 가상 여행');
  await openExtra(page, '실제 기록');
  await recordUnplanned(page, '두 번째 여행 기록', { date: '2032-06-01', note: '다른 여행' });

  await page.getByRole('button', { name: '저장소·백업', exact: true }).click();
  await page.getByRole('button', { name: '전체 백업 만들기', exact: true }).click();
  await expect(page.getByText('전체 백업 생성 완료', { exact: false })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('link', { name: '검증한 전체 백업 파일 저장' }).click();
  const path = test.info().outputPath('retro-backup.zip');
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
      .getByRole('button', { name: '가상 회고 여행' })
      .click();
    await openRetro(restored);
    await expectRetroContent(restored);
    await expect(restored.getByText('두 번째 여행 기록')).toHaveCount(0);
    await expand(restored, '.journey-library');
    await restored
      .getByRole('navigation', { name: '여행 선택' })
      .getByRole('button', { name: '두 번째 가상 여행' })
      .click();
    await openRetro(restored);
    const retro = restored.getByRole('region', { name: '날짜별 회고' });
    await retro.getByLabel('회고 날짜').selectOption('2032-06-01');
    await expect(retro.getByRole('heading', { name: '두 번째 여행 기록', level: 4 })).toBeVisible();
    await expect(retro.getByText('우연한 카페')).toHaveCount(0);
  } finally {
    await target.close();
  }
});
