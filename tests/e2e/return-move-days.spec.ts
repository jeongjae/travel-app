import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildReviewPackages, type ReviewPackage } from '../fixtures/review-packages';

// 가상 전용 검토 공간. 사용자 검토 프로필·기본 DB(travel-app)와 다른 이름이며 매번 빈 브라우저 컨텍스트에서 시작한다.
// 아래 단언은 화면에 실제로 표시되는 값만 다룬다(day.regionIds·overnightRegionId는 화면에 표시되지 않는다).
const reviewUrl = '/?workspace=content&review=fiction-return-move';
const screenshotDirectory = resolve('.cache/t01-review/screens');

let browserErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      browserErrors.push(message.text());
    }
  });
});
test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) {
    expect(browserErrors).toEqual([]);
    expect(await page.locator('vite-error-overlay').count()).toBe(0);
    expect(await page.locator('body').evaluate((element) => element.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

async function expand(page: Page, selector: string) {
  const details = page.locator(selector);
  if ((await details.getAttribute('open')) === null) {
    await details.locator(':scope > summary').click();
  }
}

async function addPackage(page: Page, item: ReviewPackage) {
  await expand(page, '.journey-library');
  await page.getByLabel('여행 패키지 선택').setInputFiles({
    name: item.fileName,
    mimeType: 'application/zip',
    buffer: Buffer.from(await item.blob.arrayBuffer()),
  });
  await page.getByRole('button', { name: '여행에 추가', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}

async function selectTrip(page: Page, name: string) {
  await expand(page, '.journey-library');
  await page.getByRole('navigation', { name: '여행 선택' }).getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible();
}

async function openDay(page: Page, cityText: string) {
  await page
    .getByRole('navigation', { name: '주요 메뉴' })
    .getByRole('button', { name: '전체 일정', exact: true })
    .click();
  await page.locator('.schedule-overview .journey-card').getByRole('button', { name: cityText, exact: true }).click();
  await expect(page.locator('.day-intro h2')).toHaveText(cityText);
}

async function shoot(page: Page, name: string, fullPage = true) {
  await mkdir(screenshotDirectory, { recursive: true });
  const project = test.info().project.name;
  await page.screenshot({ path: resolve(screenshotDirectory, `${project}-${name}.png`), fullPage });
}

test('귀국일·이동일의 날짜·활동·이동 구간·장소/지역 관계를 일정과 가이드 화면에서 확인한다', async ({ page }) => {
  const packages = await buildReviewPackages();
  const unknown = packages.find((item) => item.tripId === 'fiction-return-unknown')!;
  const explicit = packages.find((item) => item.tripId === 'fiction-return-explicit')!;
  await page.goto(reviewUrl);
  await addPackage(page, unknown);
  await addPackage(page, explicit);

  // ── 귀국일 장소 지역 미상 여행 ─────────────────────────────────────────────
  await selectTrip(page, unknown.tripName);
  await page
    .getByRole('navigation', { name: '주요 메뉴' })
    .getByRole('button', { name: '전체 일정', exact: true })
    .click();
  const cards = page.locator('.schedule-overview .journey-card');
  await expect(cards).toHaveCount(4);
  await expect(cards.nth(2)).toContainText('가상 지역 → 다른 지역');
  await expect(cards.nth(3)).toContainText('가상 귀국');
  await shoot(page, '1-overview-4days');

  // 이동일 05-03: 두 지역에 걸친 도시 표기, 출발·도착 활동, 이동 구간, 도착 지역 숙박.
  await openDay(page, '가상 지역 → 다른 지역');
  await expect(page.locator('.day-summary')).toHaveText('가상 이동일');
  await expect(page.locator('.day-intro .muted').first()).toContainText('TRANSFER DAY');
  const timeline = page.locator('.day-timeline');
  await expect(timeline.locator('.timeline-stop h3')).toHaveText(['가상 출발', '가상 도착']);
  await expect(timeline.locator('.timeline-time')).toHaveText(['09:00 ~ 10:00', '12:30']);
  await expect(timeline.locator('.timeline-leg').first()).toContainText('가상 출발 → 가상 도착');
  await expect(timeline.locator('.timeline-leg').first()).toContainText('train · 약 2시간 · 미상 · 가상 노선');
  await expect(timeline.getByRole('button', { name: '장소 안내 · 가상 장소', exact: true })).toBeVisible();
  await expect(timeline.getByRole('button', { name: '장소 안내 · 가상 다른 장소', exact: true })).toBeVisible();
  await expect(page.getByText('숙박: 가상 다른 숙소', { exact: false })).toBeVisible();
  await expect(page.getByText('숙박: 가상 숙소', { exact: false })).toHaveCount(0);
  await shoot(page, '2-move-day-0503');

  // 귀국일 05-04: 숙박 줄 없음, 장소 안내 없음(지역 미상 — 장소 참조 자체가 원천에 없다).
  await openDay(page, '가상 귀국');
  await expect(page.locator('.day-summary')).toHaveText('가상 귀국일');
  await expect(timeline.locator('.timeline-stop h3')).toHaveText(['가상 공항', '가상 선물 가게']);
  await expect(timeline.locator('.timeline-time')).toHaveText(['08:00', '11:00']);
  await expect(page.getByText('숙박:', { exact: false })).toHaveCount(0);
  await expect(timeline.getByRole('button', { name: /^장소 안내/ })).toHaveCount(0);
  await shoot(page, '3-return-day-0504-unknown');

  // ── 귀국일 장소 지역 명시 여행 ─────────────────────────────────────────────
  await selectTrip(page, explicit.tripName);
  await openDay(page, '가상 귀국');
  await expect(timeline.locator('.timeline-stop h3')).toHaveText(['가상 공항', '가상 선물 가게']);
  await expect(page.getByText('숙박:', { exact: false })).toHaveCount(0);
  await expect(timeline.getByRole('button', { name: /^장소 안내/ })).toHaveCount(1);
  await expect(timeline.getByRole('button', { name: '장소 안내 · 가상 다른 장소', exact: true })).toBeVisible();
  await shoot(page, '4-return-day-0504-explicit');

  // 장소 → 지역 관계: 가이드 목록 검색은 장소가 속한 지역 이름으로도 장소를 찾는다.
  await page
    .getByRole('navigation', { name: '주요 메뉴' })
    .getByRole('button', { name: '가이드', exact: true })
    .click();
  await page.getByLabel('이름·지역 검색').fill('다른 지역');
  const guideCards = page.locator('.guide-card');
  await expect(guideCards.getByRole('button', { name: '가상 다른 장소', exact: true })).toBeVisible();
  await expect(guideCards.getByRole('button', { name: '가상 장소', exact: true })).toHaveCount(0);
  await shoot(page, '5-guide-search-other-region', false);
  await page.getByLabel('이름·지역 검색').fill('가상 지역');
  await expect(guideCards.getByRole('button', { name: '가상 장소', exact: true })).toBeVisible();
  await expect(guideCards.getByRole('button', { name: '가상 다른 장소', exact: true })).toHaveCount(0);
  await shoot(page, '6-guide-search-fiction-region', false);
});
