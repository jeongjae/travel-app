import { test, expect, type Page } from '@playwright/test';
import { openMore, openStorage, openTripMenu } from './helpers/nav';

/**
 * C-08〔U1〕 탐색 구조·오늘 화면 정리. 가상 여행만 쓴다. 저장 명령·데이터 의미는 바꾸지 않으므로
 * 이 시험은 화면 구조(하단 탭 도달, ⋯ 메뉴, 제거 확인, 날짜 머리, 모바일 첫 화면)만 확인한다.
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

const space = (name: string) => `/?workspace=content&review=${name}-${test.info().project.name}`;
const nav = (page: Page) => page.getByRole('navigation', { name: '주요 메뉴' });

async function createTrip(page: Page, name: string) {
  await openTripMenu(page);
  await page.getByRole('button', { name: '새 여행', exact: true }).click();
  await page.getByLabel('여행 이름').fill(name);
  await page.getByLabel('시작 날짜').fill('2032-06-01');
  await page.getByLabel('종료 날짜').fill('2032-06-03');
  await page.getByLabel('시간대', { exact: false }).fill('Asia/Tokyo');
  await page.getByRole('button', { name: '여행 만들기', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible();
}
async function addActivity(page: Page, title: string) {
  await page.getByRole('button', { name: '활동 추가', exact: true }).click();
  await page.getByLabel('활동 제목').fill(title);
  await page.getByRole('button', { name: '계획 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}

test('하단 탭 다섯 개로 기존 모든 기능에 닿는다', async ({ page }) => {
  await page.goto(space('u1-nav'));
  await createTrip(page, '가상 탐색 여행');

  await expect(nav(page).getByRole('button')).toHaveText(['오늘', '일정', '가이드', '기록', '더보기']);
  await expect(nav(page)).toBeInViewport({ ratio: 1 });
  // 접힌 영역 3개와 헤더 `저장소·백업`은 없다.
  await expect(page.locator('details.journey-library, details.journey-extras, details.journey-settings')).toHaveCount(
    0,
  );
  await expect(page.getByRole('navigation', { name: '저장소 도구' })).toHaveCount(0);

  const direct: [string, string][] = [
    ['오늘', '1일차'],
    ['일정', '일정'],
    ['가이드', '가이드'],
    ['기록', '실제 기록'],
  ];
  for (const [tab, heading] of direct) {
    await nav(page).getByRole('button', { name: tab, exact: true }).click();
    await expect(page.getByRole('heading', { name: new RegExp(heading) }).first()).toBeVisible();
    await expect(nav(page).getByRole('button', { name: tab, exact: true })).toHaveAttribute('aria-current', 'page');
  }

  // 더보기 아래 기능 7개: 두 번 눌러 닿고, 그동안 `더보기` 탭이 선택 상태다.
  const more: [string, string][] = [
    ['준비·회화', '준비·회화'],
    ['예약·할 일', '예약·할 일'],
    ['변경안', '변경안'],
    ['지도', '지도·동선'],
    ['계획 버전', '계획 버전'],
    ['가져오기 기록', '가져오기 기록'],
  ];
  for (const [item, heading] of more) {
    await openMore(page, item);
    await expect(page.getByRole('heading', { name: heading, exact: false }).first()).toBeVisible();
    await expect(nav(page).getByRole('button', { name: '더보기', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
  }
  await openStorage(page);
  await expect(page.getByRole('dialog').getByRole('heading', { name: '저장소·백업', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '닫기', exact: true }).click();

  // 여행 전환·새 여행·가져오기·기존 일정은 헤더의 여행 이름에서 연다.
  await openTripMenu(page);
  for (const name of ['새 여행', '가상 여행 둘러보기']) {
    await expect(page.locator('.journey-library').getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByLabel('여행 패키지 선택')).toBeVisible();
  await expect(page.getByRole('link', { name: '기존 일정 열기', exact: true })).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: '여행 선택' }).getByRole('button', { name: '가상 탐색 여행', exact: true }),
  ).toBeVisible();
});

test('활동 카드는 방문 기록·장소·⋯만 보이고 나머지는 ⋯ 메뉴에서 쓴다. 제거는 확인을 거친다', async ({ page }) => {
  await page.goto(space('u1-menu'));
  await createTrip(page, '가상 메뉴 여행');
  await addActivity(page, '가상 산책');
  await addActivity(page, '가상 식사');
  const card = page.locator('article.timeline-stop', { hasText: '가상 산책' });

  // 장소 연결이 없으면 `장소` 단추도 없다. 보이는 단추는 방문 기록과 ⋯ 뿐이다.
  await expect(card.getByRole('button')).toHaveText(['방문 기록', '⋯']);
  for (const hidden of ['건너뜀 기록', '일정 수정', '메모', '일정에서 제거']) {
    await expect(card.getByRole('button', { name: hidden, exact: true })).toHaveCount(0);
  }

  // 키보드·화면낭독기 이름: 메뉴 단추는 활동 이름을 포함하고 열림 상태를 알린다. Esc는 닫고 초점을 돌려준다.
  const toggle = page.getByRole('button', { name: '가상 산책 더보기 메뉴', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  for (const item of ['건너뜀 기록', '일정 수정', '가상 산책 위로', '가상 산책 아래로', '메모', '일정에서 제거']) {
    await expect(card.getByRole('button', { name: item, exact: true })).toBeVisible();
  }
  await expect(card.getByRole('button', { name: '가상 산책 위로', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();

  // 바깥을 누르면 닫힌다.
  await toggle.click();
  await page.getByRole('heading', { name: /일차/ }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  // 메뉴의 `일정에서 제거` → 확인 대화상자. 취소하면 그대로, 확인하면 제거된다.
  await toggle.click();
  await card.getByRole('button', { name: '일정에서 제거', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('가상 산책', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: '취소', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(card).toHaveCount(1);
  await toggle.click();
  await card.getByRole('button', { name: '일정에서 제거', exact: true }).click();
  await dialog.getByRole('button', { name: '제거 확인', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(card).toHaveCount(0);
  await expect(page.locator('article.timeline-stop')).toHaveCount(1);
});

test('하루 머리는 날짜를 한 번만 쓰고 지역·숙박·이동은 한 곳에서 본다', async ({ page }) => {
  await page.goto(space('u1-head'));
  await createTrip(page, '가상 머리 여행');
  await addActivity(page, '가상 산책');
  await addActivity(page, '가상 식사');

  const dayPage = page.locator('.day-page');
  await expect(dayPage.getByRole('heading', { level: 2 })).toHaveText('6월 1일 (화) · 1일차');
  // ISO 날짜·`FIRST`·영문 라벨·첫 일정 카드·날짜 선택 상자가 없다.
  const text = await dayPage.innerText();
  expect(text).not.toContain('2032-06-01');
  expect(text).not.toMatch(/FIRST|NEXT|CITY DAY/);
  await expect(page.locator('.next-action')).toHaveCount(0);
  await expect(page.getByLabel('날짜', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: '날짜별 일정' }).getByRole('button')).toHaveCount(3);
  await expect(page.getByRole('navigation', { name: '날짜별 일정' }).locator('[aria-current="date"]')).toHaveCount(1);

  // 하루 지역·밤 지역은 날짜 머리 아래 한 줄이고, 아래쪽 `지역·숙박·이동` 섹션은 없다(추가 단추만 남는다).
  await expect(page.locator('.day-intro .day-regions')).toHaveText('하루 지역 없음 · 밤을 보내는 지역 없음');
  await expect(page.locator('.day-regions')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: '지역·숙박·이동' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '숙박 추가', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '이동 추가', exact: true })).toBeVisible();
  // 헤더의 검토 공간 표시는 배지이고 `검증용 저장소` 배너는 없다.
  await expect(page.locator('.review-badge')).toHaveText('검토 공간');
  await expect(page.getByText('검증용 저장소', { exact: false })).toHaveCount(0);
});

test('모바일 첫 화면에서 스크롤 없이 첫 활동 2개 이상이 보인다', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'Pixel 7(390×844) 에뮬레이션 전용');
  await page.goto(space('u1-first'));
  await createTrip(page, '가상 첫 화면 여행');
  for (const title of ['가상 산책', '가상 식사', '가상 카페']) {
    await addActivity(page, title);
  }
  await page.reload();
  await expect(page.locator('article.timeline-stop')).toHaveCount(3);
  expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
  expect(await page.evaluate(() => scrollY)).toBe(0);
  const navTop = (await nav(page).boundingBox())!.y;
  for (const title of ['가상 산책', '가상 식사']) {
    const card = page.locator('article.timeline-stop', { hasText: title });
    const box = (await card.boundingBox())!;
    expect(box.y, `${title} 시작`).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, `${title} 끝이 하단 탭 위`).toBeLessThanOrEqual(navTop);
    await expect(card.getByRole('button', { name: '방문 기록', exact: true })).toBeInViewport({ ratio: 1 });
  }
});
