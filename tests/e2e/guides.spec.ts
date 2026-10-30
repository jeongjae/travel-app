import { test, expect, type Page } from '@playwright/test';

/**
 * C-03: 지역·여행 가이드 작성/수정과 장소·지역 기본정보 수정. 가상 여행에서 생성→찾기→열기→수정→재실행→오프라인→복원을
 * desktop·mobile로 확인한다. 기존 사용자 데이터·실제 ZIP은 쓰지 않는다.
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
async function addRegion(page: Page, name: string, description = '') {
  await openTab(page, '가이드');
  await page.getByRole('button', { name: '지역 작성', exact: true }).click();
  await page.getByLabel('지역 이름').fill(name);
  if (description) {
    await page.getByLabel('지역 설명').fill(description);
  }
  await page.getByRole('button', { name: '지역 저장', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true, level: 2 })).toBeVisible();
}
async function addPlace(page: Page, name: string, region: string) {
  await openTab(page, '가이드');
  await page.getByRole('button', { name: '장소 작성', exact: true }).click();
  await page.getByLabel('장소 이름').fill(name);
  await page.getByLabel('한 줄 요약').fill('처음 요약');
  await page.getByLabel(region, { exact: true }).check();
  await page.getByLabel('왜 가는가 (필수)').fill('가상 이유');
  await page.getByRole('button', { name: '장소 저장', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true, level: 2 })).toBeVisible();
}
async function openGuideList(page: Page) {
  await openTab(page, '가이드');
  await page.getByLabel('이름·지역 검색').fill('');
}
async function openFromList(page: Page, name: string) {
  await openGuideList(page);
  await page.getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true, level: 2 })).toBeVisible();
}
async function writeRegionGuide(page: Page, title: string, sections: [string, string][]) {
  await page.getByRole('button', { name: '지역 가이드 작성', exact: true }).click();
  await page.getByLabel('가이드 제목').fill(title);
  for (const [index, [sectionTitle, body]] of sections.entries()) {
    if (index > 0) {
      await page.getByRole('button', { name: '섹션 추가', exact: true }).click();
    }
    await page.getByLabel(`섹션 ${index + 1} 제목`).fill(sectionTitle);
    await page.getByLabel(`섹션 ${index + 1} 본문`).fill(body);
  }
  await page.getByRole('button', { name: '가이드 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}

test('지역 가이드를 작성해 지역에서 찾고, 제목·본문을 고친 뒤 재실행 후에도 읽는다', async ({ page }) => {
  await page.goto('/?workspace=content');
  await createTrip(page, '가상 가이드 여행');
  await addRegion(page, '가상 동네', '동네 소개 글');

  await writeRegionGuide(page, '동네 걷기 안내', [
    ['아침 산책', '해 뜨기 전에 걷기 좋다'],
    ['시장', '평일 오전에 열린다'],
  ]);
  await expect(page.getByRole('heading', { name: '동네 걷기 안내', exact: true, level: 2 })).toBeVisible();
  await expect(page.getByText('해 뜨기 전에 걷기 좋다', { exact: true })).toBeVisible();
  await expect(page.getByText('평일 오전에 열린다', { exact: true })).toBeVisible();

  // 지역으로 돌아가면 첫 가이드가 본문으로 보이고, 두 번째 가이드는 목록 버튼으로 찾는다.
  await page.getByRole('button', { name: '이전 안내로', exact: true }).click();
  await expect(page.getByRole('heading', { name: '동네 걷기 안내', exact: true, level: 3 })).toBeVisible();
  await writeRegionGuide(page, '비 오는 날 안내', [['실내', '박물관과 카페']]);
  await page.getByRole('button', { name: '이전 안내로', exact: true }).click();
  await expect(page.getByRole('button', { name: '비 오는 날 안내', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '동네 걷기 안내', exact: true, level: 3 })).toBeVisible();

  // 제목과 섹션 본문 수정.
  await page.getByRole('button', { name: '가이드 제목 수정', exact: true }).click();
  await page.getByLabel('가이드 제목').fill('동네 걷기 안내 개정');
  await page.getByRole('button', { name: '제목 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('heading', { name: '동네 걷기 안내 개정', exact: true, level: 3 })).toBeVisible();
  await page.getByRole('button', { name: '아침 산책 편집', exact: true }).click();
  await page.getByLabel('본문 Markdown').fill('해 뜨기 전에 걷기 좋다. 개정한 문장');
  await page.getByRole('button', { name: '본문 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('개정한 문장', { exact: false })).toBeVisible();
  // 다른 섹션과 지역 설명은 그대로다.
  await expect(page.getByText('평일 오전에 열린다', { exact: true })).toBeVisible();
  await expect(page.getByText('동네 소개 글', { exact: true })).toBeVisible();

  // 재실행 뒤 목록에서 다시 찾아 읽는다.
  await page.reload();
  await expect(page.getByRole('heading', { name: '가상 가이드 여행', exact: true, level: 1 })).toBeVisible();
  await openFromList(page, '가상 동네');
  await expect(page.getByRole('heading', { name: '동네 걷기 안내 개정', exact: true, level: 3 })).toBeVisible();
  await expect(page.getByText('개정한 문장', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '비 오는 날 안내', exact: true }).click();
  await expect(page.getByRole('heading', { name: '비 오는 날 안내', exact: true, level: 2 })).toBeVisible();
  await expect(page.getByText('박물관과 카페', { exact: true })).toBeVisible();
});

test('여행 공통 가이드를 준비 화면에서 찾아 읽고 고치며, 입력 오류는 입력을 보존한다', async ({ page }) => {
  await page.goto('/?workspace=content');
  await createTrip(page, '가상 가이드 여행');
  await openTab(page, '준비');
  await page.getByRole('button', { name: '여행 가이드 작성', exact: true }).click();

  // 섹션 본문이 비면 저장되지 않고 입력이 남는다.
  await page.getByLabel('가이드 제목').fill('출발 전 점검');
  await page.getByLabel('섹션 1 제목').fill('서류');
  await page.getByRole('button', { name: '가이드 저장', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('섹션 1');
  await expect(page.getByLabel('가이드 제목')).toHaveValue('출발 전 점검');
  await expect(page.getByLabel('섹션 1 제목')).toHaveValue('서류');
  await page.getByLabel('섹션 1 본문').fill('여권과 보험 확인');
  await page.getByRole('button', { name: '가이드 저장', exact: true }).click();
  await expect(page.getByRole('heading', { name: '출발 전 점검', exact: true, level: 2 })).toBeVisible();
  await expect(page.getByText('여권과 보험 확인', { exact: true })).toBeVisible();

  // 준비 화면 목록에서 다시 찾는다.
  await openTab(page, '준비');
  await expect(page.getByRole('button', { name: '출발 전 점검', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '출발 전 점검', exact: true }).click();
  await page.getByRole('button', { name: '서류 편집', exact: true }).click();
  await page.getByLabel('섹션 제목').fill('서류와 보험');
  await page.getByLabel('본문 Markdown').fill('여권, 보험, 예약 번호 확인');
  await page.getByRole('button', { name: '본문 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('여권, 보험, 예약 번호 확인', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '가이드 제목 수정', exact: true }).click();
  await page.getByLabel('가이드 제목').fill('출발 전 점검표');
  await page.getByRole('button', { name: '제목 저장', exact: true }).click();
  await expect(page.getByRole('heading', { name: '출발 전 점검표', exact: true, level: 2 })).toBeVisible();

  // 다른 여행에는 보이지 않는다.
  await createTrip(page, '두 번째 가상 여행');
  await openTab(page, '준비');
  await expect(page.getByRole('button', { name: '출발 전 점검표', exact: true })).toHaveCount(0);
  await expand(page, '.journey-library');
  await page.getByRole('navigation', { name: '여행 선택' }).getByRole('button', { name: '가상 가이드 여행' }).click();
  await openTab(page, '준비');
  await expect(page.getByRole('button', { name: '출발 전 점검표', exact: true })).toBeVisible();

  // 재실행 뒤에도 같다.
  await page.reload();
  await expand(page, '.journey-library');
  await page.getByRole('navigation', { name: '여행 선택' }).getByRole('button', { name: '가상 가이드 여행' }).click();
  await openTab(page, '준비');
  await page.getByRole('button', { name: '출발 전 점검표', exact: true }).click();
  await expect(page.getByText('여권, 보험, 예약 번호 확인', { exact: true })).toBeVisible();
});

test('지역·장소 기본정보를 고치면 목록·검색·상세·연결 일정에 반영되고 과거 계획은 당시 값을 읽는다', async ({
  page,
}) => {
  await page.goto('/?workspace=content');
  await createTrip(page, '가상 가이드 여행');
  await addRegion(page, '가상 동네', '처음 설명');
  await addRegion(page, '가상 해변');
  await addPlace(page, '가상 카페', '가상 동네');
  await openTab(page, '오늘');
  await page.getByRole('button', { name: '활동 추가', exact: true }).click();
  await page.getByLabel('연결할 장소').selectOption({ label: '가상 카페' });
  await page.getByLabel('활동 제목').fill('카페 방문');
  await page.getByRole('button', { name: '계획 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();

  // 장소 기본정보: 이름·종류·요약·지역을 바꾼다. 본문(가이드)은 그대로다.
  await openFromList(page, '가상 카페');
  await page.getByRole('button', { name: '기본정보 수정', exact: true }).click();
  await page.getByLabel('장소 이름').fill('새 가상 카페');
  await page.getByLabel('장소 종류').fill('카페');
  await page.getByLabel('한 줄 요약').fill('바뀐 요약');
  await page.getByLabel('가상 동네', { exact: true }).uncheck();
  await page.getByLabel('가상 해변', { exact: true }).check();
  await page.getByRole('button', { name: '기본정보 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('heading', { name: '새 가상 카페', exact: true, level: 2 })).toBeVisible();
  await expect(page.getByText('바뀐 요약', { exact: true })).toBeVisible();
  await expect(page.getByText('가상 이유', { exact: true })).toBeVisible();

  // 지역 기본정보.
  await openFromList(page, '가상 동네');
  await page.getByRole('button', { name: '기본정보 수정', exact: true }).click();
  await page.getByLabel('지역 이름').fill('새 가상 동네');
  await page.getByLabel('한 줄 소개').fill('새 한 줄 소개');
  await page.getByLabel('지역 설명').fill('바뀐 설명');
  await page.getByRole('button', { name: '기본정보 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('heading', { name: '새 가상 동네', exact: true, level: 2 })).toBeVisible();
  await expect(page.getByText('바뀐 설명', { exact: true })).toBeVisible();

  // 목록·검색에는 새 이름, 장소는 새 지역 이름으로 검색된다.
  await openGuideList(page);
  await expect(page.getByRole('button', { name: '새 가상 동네', exact: true })).toBeVisible();
  await expect(page.getByText('새 한 줄 소개', { exact: true })).toBeVisible();
  await page.getByLabel('이름·지역 검색').fill('해변');
  await expect(page.getByRole('button', { name: '새 가상 카페', exact: true })).toBeVisible();
  await page.getByLabel('이름·지역 검색').fill('동네');
  await expect(page.getByRole('button', { name: '새 가상 카페', exact: true })).toHaveCount(0);

  // 연결 일정은 최신 이름으로 장소 상세를 연다.
  await openTab(page, '오늘');
  await page.getByRole('button', { name: '장소 안내 · 새 가상 카페', exact: true }).click();
  await expect(page.getByRole('heading', { name: '새 가상 카페', exact: true, level: 2 })).toBeVisible();
  await expect(page.getByText('현재 내용', { exact: true })).toBeVisible();

  // 과거 계획에서 연 상세는 당시 이름·요약을 고정해 보여주고 기본정보 수정을 제공하지 않는다.
  await page.getByRole('button', { name: '일정으로 돌아가기', exact: true }).click();
  await expand(page, '.journey-extras');
  await expand(page, '.journey-settings');
  const options = await page.getByLabel('계획 버전').locator('option').allTextContents();
  const earlier = options.find((text) => text.includes('사용자 일정 수정'));
  expect(earlier, options.join('|')).toBeTruthy();
  await page.getByLabel('계획 버전').selectOption({ label: earlier! });
  await expect(page.getByText('과거 계획', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: /^장소 안내 · / }).click();
  await expect(page.getByText('당시 고정 내용', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '가상 카페', exact: true, level: 2 })).toBeVisible();
  await expect(page.getByText('처음 요약', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '기본정보 수정', exact: true })).toHaveCount(0);

  // 재실행 뒤에도 최신 정보를 읽는다.
  await page.reload();
  await openFromList(page, '새 가상 카페');
  await expect(page.getByText('바뀐 요약', { exact: true })).toBeVisible();
});

test('통신이 끊긴 상태에서도 가이드를 작성·수정하고 재실행 뒤에 읽는다', async ({ page, context }) => {
  await page.goto('/?workspace=content');
  await createTrip(page, '가상 가이드 여행');
  await addRegion(page, '가상 동네');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForTimeout(400);
  await context.setOffline(true);
  await page.reload();
  await openFromList(page, '가상 동네');
  await writeRegionGuide(page, '오프라인 안내', [['현장', '현장에서 쓴 글']]);
  await page.getByRole('button', { name: '현장 편집', exact: true }).click();
  await page.getByLabel('본문 Markdown').fill('현장에서 고친 글');
  await page.getByRole('button', { name: '본문 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await openTab(page, '준비');
  await page.getByRole('button', { name: '여행 가이드 작성', exact: true }).click();
  await page.getByLabel('가이드 제목').fill('오프라인 점검');
  await page.getByLabel('섹션 1 제목').fill('짐');
  await page.getByLabel('섹션 1 본문').fill('충전기 확인');
  await page.getByRole('button', { name: '가이드 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.reload();
  await openTab(page, '준비');
  await page.getByRole('button', { name: '오프라인 점검', exact: true }).click();
  await expect(page.getByText('충전기 확인', { exact: true })).toBeVisible();
  await openFromList(page, '가상 동네');
  await expect(page.getByText('현장에서 고친 글', { exact: true })).toBeVisible();
});

test('가이드와 기본정보 수정이 든 두 여행을 전체 백업해 빈 브라우저에 복원하면 격리된 채 같은 내용을 읽는다', async ({
  page,
  browser,
}) => {
  await page.goto('/?workspace=content');
  await createTrip(page, '가상 가이드 여행');
  await addRegion(page, '가상 동네', '처음 설명');
  await writeRegionGuide(page, '동네 안내', [['걷기', '복원될 본문']]);
  await openFromList(page, '가상 동네');
  await page.getByRole('button', { name: '기본정보 수정', exact: true }).click();
  await page.getByLabel('지역 이름').fill('수정된 가상 동네');
  await page.getByRole('button', { name: '기본정보 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await openTab(page, '준비');
  await page.getByRole('button', { name: '여행 가이드 작성', exact: true }).click();
  await page.getByLabel('가이드 제목').fill('출발 전 점검');
  await page.getByLabel('섹션 1 제목').fill('서류');
  await page.getByLabel('섹션 1 본문').fill('복원될 준비 본문');
  await page.getByRole('button', { name: '가이드 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await createTrip(page, '두 번째 가상 여행');
  await openGuideList(page);
  await expect(page.getByRole('button', { name: '수정된 가상 동네', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: '저장소·백업', exact: true }).click();
  await page.getByRole('button', { name: '전체 백업 만들기', exact: true }).click();
  await expect(page.getByText('전체 백업 생성 완료', { exact: false })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('link', { name: '검증한 전체 백업 파일 저장' }).click();
  const path = test.info().outputPath('guides-backup.zip');
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
      .getByRole('button', { name: '가상 가이드 여행' })
      .click();
    await restored.getByRole('button', { name: '가이드', exact: true }).first().click();
    await restored.getByRole('button', { name: '수정된 가상 동네', exact: true }).click();
    await expect(restored.getByRole('heading', { name: '동네 안내', exact: true, level: 3 })).toBeVisible();
    await expect(restored.getByText('복원될 본문', { exact: true })).toBeVisible();
    await restored.getByRole('button', { name: '준비', exact: true }).first().click();
    await restored.getByRole('button', { name: '출발 전 점검', exact: true }).click();
    await expect(restored.getByText('복원될 준비 본문', { exact: true })).toBeVisible();
    await expand(restored, '.journey-library');
    await restored
      .getByRole('navigation', { name: '여행 선택' })
      .getByRole('button', { name: '두 번째 가상 여행' })
      .click();
    await restored.getByRole('button', { name: '준비', exact: true }).first().click();
    await expect(restored.getByRole('button', { name: '출발 전 점검', exact: true })).toHaveCount(0);
  } finally {
    await target.close();
  }
});
