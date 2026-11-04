import { test, expect, type Page } from '@playwright/test';
import { openTripMenu, planVersionSelect, removeActivity } from './helpers/nav';

/**
 * C-12〔U3〕 읽기 화면 정리. 가상 여행만 쓴다. 데이터·저장 명령은 그대로이고 표시만 바뀐다.
 * (a) 기록 목록: 날짜 머리 아래 시각 순 + 정정 체인 1행·접기 (b) 회고: 버전 이름·변경 배지·설명 접기
 * (d) 가이드: 지역별 묶음과 검색 (e) 모바일 회고 열 머리 고정. (c) 날짜 변화 판정은 단위 시험(c12-ui-rules)에서 본다.
 */
let browserErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  browserErrors = [];
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

const space = (name: string) => `/?workspace=content&review=${name}-${test.info().project.name}`;
const isMobile = () => test.info().project.name === 'mobile';

async function openTab(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).first().click();
}
async function createTrip(page: Page, name: string) {
  await openTripMenu(page);
  await page.getByRole('button', { name: '새 여행', exact: true }).click();
  await page.getByLabel('여행 이름').fill(name);
  await page.getByLabel('시작 날짜').fill('2032-06-01');
  await page.getByLabel('종료 날짜').fill('2032-06-03');
  await page.getByRole('button', { name: '여행 만들기', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible();
}
async function recordOn(page: Page, title: string, date: string, clock: string) {
  await page.getByRole('button', { name: '예정 외 활동 기록', exact: true }).click();
  await page.getByLabel('활동 이름').fill(title);
  await page.getByLabel('날짜', { exact: true }).fill(date);
  await page.getByLabel('시각 (선택)', { exact: true }).fill(clock);
  await page.getByRole('button', { name: '실제 기록 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}
const row = (page: Page, title: string) => page.locator('article.content-row', { hasText: title });
async function correctNote(page: Page, title: string, note: string) {
  await row(page, title).getByRole('button', { name: '정정', exact: true }).click();
  await page.getByLabel('기록 메모').fill(note);
  await page.getByRole('button', { name: '실제 기록 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}
async function addActivity(page: Page, title: string) {
  await page.getByRole('button', { name: '활동 추가', exact: true }).click();
  await page.getByLabel('활동 제목').fill(title);
  await page.getByRole('button', { name: '계획 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}

test('기록 목록: 날짜 머리 아래 시각 순이고 정정 체인은 최신본 1행 + 접기이며 정정 버튼은 최신본에만 있다', async ({
  page,
}) => {
  await page.goto(space('u3-records'));
  await createTrip(page, '가상 기록 여행');
  await page.getByRole('button', { name: '기록', exact: true }).click();
  await recordOn(page, '저녁 식사', '2032-06-02', '19:00');
  await recordOn(page, '아침 산책', '2032-06-02', '08:30');
  await recordOn(page, '다음 날 시장', '2032-06-03', '07:00');

  // 날짜 머리(월·일·요일) 아래 시각 순. 2032-06-02는 수요일이다.
  const headings = page.locator('.record-day > h3');
  await expect(headings).toHaveText(['6월 2일 (수)', '6월 3일 (목)']);
  await expect(page.locator('.record-day').first().locator('h4')).toHaveText(['아침 산책', '저녁 식사']);
  // 옛 세 묶음 제목은 더 이상 쓰지 않고, 정밀도 용어는 행의 보조 문구로 간다.
  await expect(page.getByText(/현지 시각|확인된 발생 시점/).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: '날짜·현지 시각·원문으로 확인한 기록' })).toHaveCount(0);

  // 정정 두 번: 행은 여전히 하나, 접기에서 원문·중간본을 읽고 정정 버튼은 최신본에만 있다.
  await correctNote(page, '아침 산책', '첫 정정');
  await correctNote(page, '아침 산책', '둘째 정정');
  await expect(row(page, '아침 산책')).toHaveCount(1);
  await expect(row(page, '아침 산책').getByRole('button', { name: '정정', exact: true })).toHaveCount(1);
  const fold = row(page, '아침 산책').locator('details.correction-fold');
  await expect(fold.locator('summary')).toHaveText('정정 2회 · 원문 보기');
  await expect(fold.getByText('정정 1/3단계', { exact: false })).toBeHidden();
  await fold.locator('summary').click();
  await expect(fold.getByText('정정 1/3단계 · 이후 정정본 있음', { exact: false })).toBeVisible();
  await expect(fold.getByText('정정 3/3단계 · 최신 정정본', { exact: false })).toBeVisible();
  await expect(fold.getByRole('button', { name: '정정', exact: true })).toHaveCount(0);

  // `기록 당시 내용`·`앱에 남긴 시각`은 ⋯ 안에 있다.
  const more = row(page, '다음 날 시장').locator('details.row-more');
  await expect(more.getByRole('button', { name: '기록 당시 내용', exact: true })).toBeHidden();
  await more.getByLabel('기록 더 보기').click();
  await expect(more.getByRole('button', { name: '기록 당시 내용', exact: true })).toBeVisible();
  await expect(more.getByText('앱에 남긴 시각', { exact: false })).toBeVisible();
});

test('회고: 버전 이름에 저장 시각이 보이고, 추가·제거 배지가 붙으며, 설명은 `계획 설명` 단추 안에 있다', async ({
  page,
}) => {
  await page.goto(space('u3-retro'));
  await createTrip(page, '가상 회고 여행');
  await openTab(page, '오늘');
  await addActivity(page, '지울 활동');
  await addActivity(page, '남길 활동');
  // 선택할 과거 계획은 두 활동이 모두 있는 계획이다. 이후 하나를 지우고 하나를 더한다.
  // 첫 카드가 '지울 활동'이다(추가 순서대로 정렬).
  await removeActivity(page, page);
  await addActivity(page, '새로 넣은 활동');

  await page.getByRole('button', { name: '기록', exact: true }).click();
  await page.getByRole('button', { name: '날짜별 회고 보기', exact: true }).click();
  const retro = page.getByRole('region', { name: '날짜별 회고' });
  await expect(retro).toBeVisible();

  // 설명문은 `계획 설명` 접기 안에 있고 본문에는 사실만 남는다.
  await expect(retro.getByText('읽기 전용입니다.', { exact: false })).toBeHidden();
  await retro.getByText('계획 설명', { exact: true }).click();
  await expect(retro.getByText('읽기 전용입니다.', { exact: false })).toBeVisible();

  // 버전 이름: 저장 시각 + 이유(번호는 보조). 현재 계획은 저장 시각만 붙는다.
  const select = retro.getByLabel('회고 계획 버전');
  const names = await select.locator('option').allTextContents();
  expect(names[0]).toMatch(/^현재 계획 \(\d\d\/\d\d \d\d:\d\d\)$/);
  const past = names.slice(1);
  expect(past.length).toBeGreaterThan(0);
  for (const name of past) {
    expect(name).toMatch(/^\d\d\/\d\d \d\d:\d\d · .+ · 계획 \d+$/);
    expect(name).not.toMatch(/^과거 계획/);
  }

  // 두 활동이 모두 있던 계획(제거 직전)을 고르면: 지운 활동은 선택 열에서 `제거`, 새 활동은 현재 열에서 `추가`.
  await retro.getByLabel('회고 날짜').selectOption('2032-06-01');
  // 계획 3(두 활동이 모두 있음)은 과거 계획 목록에서 위로부터 세 번째(현재 계획 다음의 2번째) 옵션이다.
  const beforeRemoval = await select.locator('option').nth(2).getAttribute('value');
  await select.selectOption(beforeRemoval!);
  const currentColumn = retro.getByRole('article', { name: /^현재 계획 [0-9]+$/ });
  const pastColumn = retro.getByRole('article', { name: /^과거 계획 [0-9]+$/ });
  await expect(currentColumn.locator('li', { hasText: '새로 넣은 활동' }).locator('.retro-badge')).toHaveText('추가');
  await expect(pastColumn.locator('li', { hasText: '지울 활동' }).locator('.retro-badge')).toHaveText('제거');
  // 같은 항목에는 배지가 없다.
  await expect(currentColumn.locator('li', { hasText: '남길 활동' }).locator('.retro-badge')).toHaveCount(0);
  await expect(pastColumn.locator('li', { hasText: '남길 활동' }).locator('.retro-badge')).toHaveCount(0);

  // 열 배치: 데스크톱은 나란히, 모바일은 쌓고 열 머리를 고정한다.
  const heads = retro.locator('.retro-column-head');
  await expect(heads).toHaveCount(2);
  if (isMobile()) {
    for (const index of [0, 1]) {
      expect(await heads.nth(index).evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
    }
    const first = await heads.nth(0).boundingBox();
    const second = await heads.nth(1).boundingBox();
    expect(second!.y).toBeGreaterThan(first!.y);
  } else {
    const first = await currentColumn.boundingBox();
    const second = await pastColumn.boundingBox();
    expect(Math.abs(first!.y - second!.y)).toBeLessThan(4);
    expect(second!.x).toBeGreaterThan(first!.x);
  }
});

async function addRegion(page: Page, name: string, tagline: string) {
  await openTab(page, '가이드');
  await page.getByRole('button', { name: '지역 작성', exact: true }).click();
  await page.getByLabel('지역 이름').fill(name);
  await page.getByLabel('한 줄 소개').fill(tagline);
  await page.getByRole('button', { name: '지역 저장', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true, level: 2 })).toBeVisible();
}
async function addPlace(page: Page, name: string, region?: string) {
  await openTab(page, '가이드');
  await page.getByRole('button', { name: '장소 작성', exact: true }).click();
  await page.getByLabel('장소 이름').fill(name);
  await page.getByLabel('한 줄 요약').fill(`${name} 요약`);
  if (region) {
    await page.getByLabel(region, { exact: true }).check();
  }
  await page.getByLabel('왜 가는가 (필수)').fill('가상 이유');
  await page.getByRole('button', { name: '장소 저장', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true, level: 2 })).toBeVisible();
}

test('가이드: 지역 머리 아래에 장소가 묶이고, 검색은 일치하는 지역만 남기며, 지역 가이드 작성은 지역 안에만 있다', async ({
  page,
}) => {
  await page.goto(space('u3-guide'));
  await createTrip(page, '가상 가이드 여행');
  await addRegion(page, '북쪽 동네', '북쪽 설명 한 줄');
  await addRegion(page, '남쪽 동네', '남쪽 설명 한 줄');
  await addPlace(page, '북쪽 카페', '북쪽 동네');
  await addPlace(page, '남쪽 시장', '남쪽 동네');
  await addPlace(page, '떠도는 전망대');

  await openTab(page, '가이드');
  await page.getByLabel('이름·지역 검색').fill('');
  const north = page.locator('section.guide-region', { hasText: '북쪽 동네' });
  const south = page.locator('section.guide-region', { hasText: '남쪽 동네' });
  const none = page.locator('section.guide-region', { hasText: '지역 없는 장소' });
  await expect(north.getByText('북쪽 설명 한 줄')).toBeVisible();
  await expect(north.getByText('지역 가이드 0개 · 장소 1곳')).toBeVisible();
  await expect(north.getByRole('button', { name: '북쪽 카페', exact: true })).toBeVisible();
  await expect(south.getByRole('button', { name: '남쪽 시장', exact: true })).toBeVisible();
  await expect(none.getByRole('button', { name: '떠도는 전망대', exact: true })).toBeVisible();
  // 목록 화면에는 지역 가이드 작성 버튼이 없고, 지역 작성·장소 작성은 그대로 있다.
  await expect(page.getByRole('button', { name: '지역 가이드 작성', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '지역 작성', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '장소 작성', exact: true })).toBeVisible();

  // 검색: 일치하는 장소가 있는 지역만 남고, 지역 없는 장소는 이름이 맞을 때만 남는다.
  await page.getByLabel('이름·지역 검색').fill('시장');
  await expect(south).toBeVisible();
  await expect(north).toHaveCount(0);
  await expect(none).toHaveCount(0);
  await page.getByLabel('이름·지역 검색').fill('북쪽');
  await expect(north.getByRole('button', { name: '북쪽 카페', exact: true })).toBeVisible();
  await expect(south).toHaveCount(0);
  await page.getByLabel('이름·지역 검색').fill('전망대');
  await expect(none).toBeVisible();
  await expect(north).toHaveCount(0);

  // 결과가 없으면 안내와 함께 검색어를 지울 수 있다.
  await page.getByLabel('이름·지역 검색').fill('없는이름');
  await expect(page.getByText('일치하는 장소가 없습니다', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '검색어 지우기', exact: true }).click();
  await expect(page.getByLabel('이름·지역 검색')).toHaveValue('');
  await expect(north).toBeVisible();

  // 지역 머리를 누르면 지역 상세가 열리고 거기서만 지역 가이드를 쓴다.
  await north.getByRole('button', { name: '북쪽 동네', exact: true }).click();
  await expect(page.getByRole('heading', { name: '북쪽 동네', exact: true, level: 2 })).toBeVisible();
  await expect(page.getByRole('button', { name: '지역 가이드 작성', exact: true })).toBeVisible();
});

test('C8 오늘: 예정 외 기록은 타임라인에 기록 카드로, 방문 기록은 계획 카드 배지로 보이고 계획은 그대로다', async ({
  page,
}) => {
  await page.goto(space('u3-today'));
  await openTripMenu(page);
  await page.getByRole('button', { name: '새 여행', exact: true }).click();
  await page.getByLabel('여행 이름').fill('가상 오늘 여행');
  await page.getByLabel('시작 날짜').fill('2032-06-01');
  await page.getByLabel('종료 날짜').fill('2032-06-03');
  await page.getByLabel('시간대', { exact: false }).fill('Asia/Tokyo');
  await page.getByRole('button', { name: '여행 만들기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '가상 오늘 여행', exact: true, level: 1 })).toBeVisible();
  await openTab(page, '오늘');
  await addActivity(page, '가상 산책');

  const planCount = async () => {
    const select = await planVersionSelect(page);
    const count = await select.locator('option').count();
    await openTab(page, '오늘');
    return count;
  };
  const versionsBefore = await planCount();
  await expect(page.locator('article.timeline-stop')).toHaveCount(1);
  await expect(page.locator('article.timeline-record')).toHaveCount(0);

  // 예정 외 기록을 저장하면 같은 화면에서 알림과 기록 카드가 보인다.
  await page.getByRole('button', { name: '예정 외 활동 기록', exact: true }).click();
  await page.getByLabel('활동 이름').fill('길가의 벤치');
  await page.getByLabel('기록 메모').fill('잠깐 쉬었다');
  await page.getByRole('button', { name: '실제 기록 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(
    page.getByText('예정 외 활동을 기록했습니다. 아래 타임라인과 `기록` 탭에서 볼 수 있습니다.'),
  ).toBeVisible();
  const card = page.locator('article.timeline-record', { hasText: '길가의 벤치' });
  await expect(card).toBeVisible();
  await expect(card.getByText('예정 외', { exact: true })).toBeVisible();
  await expect(card.getByText('잠깐 쉬었다')).toBeVisible();
  // 기록 카드에는 계획 편집 메뉴가 없고 `정정`과 `기록 탭에서 보기`만 있다.
  await expect(card.locator('.menu-toggle')).toHaveCount(0);
  await expect(card.getByRole('button')).toHaveText(['정정', '기록 탭에서 보기']);

  // 계획 데이터 불변: 계획 항목 수와 계획 버전 수가 그대로다.
  await expect(page.locator('article.timeline-stop')).toHaveCount(1);
  expect(await planCount()).toBe(versionsBefore);

  // 방문 기록은 계획 카드의 한 줄 배지로 보인다(기록 카드가 더 생기지 않는다).
  await page
    .locator('article.timeline-stop', { hasText: '가상 산책' })
    .getByRole('button', { name: '방문 기록', exact: true })
    .click();
  await expect(
    page.locator('article.timeline-stop', { hasText: '가상 산책' }).locator('.record-badge-pill'),
  ).toHaveText(/^방문 \d\d:\d\d$/);
  await expect(page.locator('article.timeline-record')).toHaveCount(1);
  expect(await planCount()).toBe(versionsBefore);

  // 기록 카드의 동작: 정정은 폼을 열고, 기록 탭에서 보기는 기록 탭으로 간다.
  await card.getByRole('button', { name: '정정', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await card.getByRole('button', { name: '기록 탭에서 보기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '실제 활동 기록' })).toBeVisible();
  await expect(page.locator('article.record-row', { hasText: '길가의 벤치' })).toBeVisible();
});
