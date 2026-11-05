import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { dump, domain, counts, tripIdOf } from './helpers/space-dump';
import { menuAction, openMore, openStorage, openTripMenu, selectDayByDate } from './helpers/nav';

/**
 * C-13〔U4〕 삿포로 대본 v2(축약) 리허설. `docs/u4-sapporo-scenario.md`의 단계 S1~S6을 화면의 단추 글자 그대로 따른다.
 * c07 대본·시험은 회귀 보존용으로 그대로 두고, 이 시험은 사용자가 30분 안에 한 번에 확인할 v2 경로만 다룬다.
 * 모든 장소·설명·일정은 가상 자료이며 사용자 공간·실제 ZIP은 쓰지 않는다. `UI_U4_SHOTS=1`일 때만 스크린샷을 남긴다.
 */
test.use({ actionTimeout: 10_000 });
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

const TRIP = '삿포로 연말 가상 여행';
const OTHER = '가상 산책 여행 A';
const START = '2026-12-31';
const NEW_YEAR = '2027-01-01';
const THIRD = '2027-01-02';
const END = '2027-01-03';
const ZONE = 'Asia/Tokyo';
const MOVE_REASON = '가상 연휴 휴무 가정';
const space = (name: string) => `/?workspace=content&review=${name}`;
const nav = (page: Page) => page.getByRole('navigation', { name: '주요 메뉴' });

async function openTab(page: Page, name: string) {
  await nav(page).getByRole('button', { name, exact: true }).click();
}
const stop = (page: Page, title: string): Locator =>
  page.locator('article.timeline-stop').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
const timelineTitles = (page: Page) => page.locator('.day-timeline article.timeline-stop h3').allTextContents();
const recordCards = (page: Page) => page.locator('.day-timeline article.timeline-record h3').allTextContents();

async function shot(page: Page, name: string) {
  if (process.env.UI_U4_SHOTS !== '1') {
    return;
  }
  const directory = resolve('docs/design/ui-u4');
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(directory, `${name}-${test.info().project.name}.png`), fullPage: false });
}

async function addRegion(page: Page, name: string, description: string) {
  await openTab(page, '가이드');
  await page.getByRole('button', { name: '지역 작성', exact: true }).click();
  await page.getByLabel('지역 이름').fill(name);
  await page.getByLabel('지역 설명').fill(description);
  await page.getByRole('button', { name: '지역 저장', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true, level: 2 })).toBeVisible();
}
async function addPlace(page: Page, name: string, region: string, summary: string) {
  await openTab(page, '가이드');
  await page.getByRole('button', { name: '장소 작성', exact: true }).click();
  await page.getByLabel('장소 이름').fill(name);
  await page.getByLabel('한 줄 요약').fill(summary);
  await page.getByLabel(region, { exact: true }).check();
  await page.getByLabel('왜 가는가 (필수)').fill('가상 이유');
  await page.getByRole('button', { name: '장소 저장', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true, level: 2 })).toBeVisible();
}
async function addActivity(
  page: Page,
  title: string,
  options: { place?: string; date: string; time?: string; end?: string },
) {
  await openTab(page, '오늘');
  await page.getByRole('button', { name: '활동 추가', exact: true }).click();
  if (options.place) {
    await page.getByLabel('연결할 장소').selectOption({ label: options.place });
  }
  await page.getByLabel('활동 제목').fill(title);
  await page.getByLabel('계획 날짜').selectOption({ label: options.date });
  if (options.time) {
    await page.getByLabel('시각 (선택)', { exact: true }).fill(options.time);
  }
  if (options.end) {
    await page.getByLabel('종료 시각 (선택)').fill(options.end);
  }
  await page.getByRole('button', { name: '계획 저장', exact: true }).click();
  if (options.end) {
    // 종료 시각이 시작보다 이르면 다음 날로 저장할지 묻는다.
    await page.getByRole('group', { name: '다음 날 확인' }).getByRole('button', { name: '다음 날로 저장' }).click();
  }
  await expect(page.getByRole('dialog')).not.toBeVisible();
}
async function backupTo(page: Page, file: string) {
  await openStorage(page);
  await page.getByRole('button', { name: '전체 백업 만들기', exact: true }).click();
  await expect(page.getByText('전체 백업 생성 완료', { exact: false })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('link', { name: '검증한 전체 백업 파일 저장' }).click();
  await (await downloaded).saveAs(file);
}
async function selectTrip(page: Page, name: string) {
  await openTripMenu(page);
  await page.getByRole('navigation', { name: '여행 선택' }).getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible();
}
async function emptyTarget(browser: Browser, page: Page, review: string) {
  const context = await browser.newContext({ viewport: page.viewportSize() ?? undefined, serviceWorkers: 'allow' });
  const target = await context.newPage();
  await target.route('**/api/ai/v2/status', (route) => route.fulfill({ json: { configured: false } }));
  await target.goto(`http://127.0.0.1:4173${space(review)}`);
  await expect(target.locator('.review-badge')).toHaveText('검토 공간');
  return { context, target };
}

test('삿포로 대본 v2: 새 여행→가이드→계획(변경 이유)→현장 기록→회고→백업·빈 공간 복원', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const project = test.info().project.name;
  const source = `u4-src-${project}`;
  const destination = `u4-dst-${project}`;

  await test.step('S1 · 새 여행: 기간·시간대 자동 적용', async () => {
    await page.goto(space(source));
    await openTripMenu(page);
    await page.getByRole('button', { name: '새 여행', exact: true }).click();
    await page.getByLabel('여행 이름').fill(TRIP);
    await page.getByLabel('시작 날짜').fill(START);
    await page.getByLabel('종료 날짜').fill(END);
    await page.getByLabel('시간대 (확인한 경우만)').fill(ZONE);
    await page.getByRole('button', { name: '여행 만들기', exact: true }).click();
    await expect(page.getByRole('heading', { name: TRIP, exact: true, level: 1 })).toBeVisible();
    await openTab(page, '일정');
    await expect(page.locator('.journey-card')).toHaveCount(4);
    await shot(page, 's1-new-trip');
    // 시간대는 여행 기본값이 자동으로 쓰인다: 활동 폼의 `자세히`에서 확인한다.
    await openTab(page, '오늘');
    await page.getByRole('button', { name: '활동 추가', exact: true }).click();
    await page.getByRole('dialog').getByText('자세히', { exact: true }).click();
    await expect(page.getByText('시간대: Asia/Tokyo (여행 기본)')).toBeVisible();
    await page.getByRole('button', { name: '닫기', exact: true }).click();
  });

  await test.step('S2 · 가이드: 지역 2·장소 3, 지역 묶음 화면, 검색 0건', async () => {
    await addRegion(page, '삿포로', '가상 설명: 겨울에 걷기 좋은 홋카이도 중심 도시');
    await page.getByRole('button', { name: '목록으로', exact: true }).click();
    await addRegion(page, '오타루', '가상 설명: 삿포로에서 당일로 다녀오는 근교 항구 도시');
    await page.getByRole('button', { name: '목록으로', exact: true }).click();
    await addPlace(page, '신치토세 공항', '삿포로', '도착 후 시내로 가는 관문');
    await addPlace(page, '오도리 공원', '삿포로', '도심 한가운데의 긴 공원');
    await addPlace(page, '오타루 운하', '오타루', '근교 운하 산책길');
    await openTab(page, '가이드');
    await page.getByLabel('이름·지역 검색').fill('');
    const sapporo = page
      .locator('section.guide-region')
      .filter({ has: page.getByRole('heading', { name: '삿포로', level: 3 }) });
    const otaru = page
      .locator('section.guide-region')
      .filter({ has: page.getByRole('heading', { name: '오타루', level: 3 }) });
    await expect(sapporo.getByText('지역 가이드 0개 · 장소 2곳')).toBeVisible();
    await expect(sapporo.getByRole('button', { name: '신치토세 공항', exact: true })).toBeVisible();
    await expect(sapporo.getByRole('button', { name: '오도리 공원', exact: true })).toBeVisible();
    await expect(otaru.getByText('지역 가이드 0개 · 장소 1곳')).toBeVisible();
    await expect(otaru.getByRole('button', { name: '오타루 운하', exact: true })).toBeVisible();
    // 사진이 없는 장소 행은 자리 비움 없이 글자만 있다.
    await expect(page.locator('li.guide-place-row img')).toHaveCount(0);
    await shot(page, 's2-guide-regions');
    await page.getByLabel('이름·지역 검색').fill('없는이름');
    await expect(page.getByText('일치하는 장소가 없습니다', { exact: false })).toBeVisible();
    await shot(page, 's2-guide-empty');
    await page.getByRole('button', { name: '검색어 지우기', exact: true }).click();
    await expect(page.getByLabel('이름·지역 검색')).toHaveValue('');
    await expect(sapporo).toBeVisible();
  });

  await test.step('S3 · 계획: 활동 5건, 종료 시각(다음 날), 변경 이유, 숙박 1건', async () => {
    await addActivity(page, '공항 도착', { place: '신치토세 공항', date: START, time: '14:00' });
    await addActivity(page, '카운트다운 산책', { place: '오도리 공원', date: START, time: '23:30', end: '00:30' });
    await addActivity(page, '신년 산책', { place: '오도리 공원', date: NEW_YEAR });
    await addActivity(page, '오타루 운하 산책', { place: '오타루 운하', date: THIRD });
    await addActivity(page, '공항으로 이동', { place: '신치토세 공항', date: END });
    await openTab(page, '오늘');
    await selectDayByDate(page, START);
    await expect.poll(() => timelineTitles(page)).toEqual(['공항 도착', '카운트다운 산책']);
    await expect(page.locator('article.timeline-stop .timeline-time')).toHaveText(['14:00', '23:30 ~ 00:30 (다음 날)']);
    await shot(page, 's3-plan-day');

    await page.getByRole('button', { name: '숙박 추가', exact: true }).click();
    await page.getByLabel('숙박 이름·거점').fill('가상 시내 호텔');
    await page.getByLabel('지역 (선택)').selectOption({ label: '삿포로' });
    await page.getByLabel('입실 날짜').fill(START);
    await page.getByLabel('퇴실 날짜').fill(END);
    await page.getByLabel('변경 이유').fill('가상 숙소 3박 확정');
    await page.getByRole('button', { name: '숙박 저장', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.locator('.day-regions')).toContainText('하루 지역 삿포로 · 밤을 보내는 지역 삿포로');

    // 일정 수정의 변경 이유를 화면에서 입력한다(메모로 우회하지 않는다).
    await selectDayByDate(page, NEW_YEAR);
    await menuAction(stop(page, '신년 산책'), '일정 수정');
    await page.getByLabel('계획 날짜').selectOption({ label: THIRD });
    await page.getByLabel('변경 이유 (선택)').fill(MOVE_REASON);
    await shot(page, 's3-edit-reason');
    await page.getByRole('button', { name: '계획 저장', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await selectDayByDate(page, THIRD);
    await expect.poll(() => timelineTitles(page)).toEqual(['오타루 운하 산책', '신년 산책']);
    await openMore(page, '계획 버전');
    await expect(page.locator('option', { hasText: MOVE_REASON })).toHaveCount(1);
  });

  await test.step('S4 · 현장: 방문 한 번, 정정으로 연도 경계, 예정 외 기록, 기록 탭', async () => {
    await openTab(page, '오늘');
    await selectDayByDate(page, START);
    await page.clock.setFixedTime(new Date('2026-12-31T05:20:00Z'));
    await stop(page, '공항 도착').getByRole('button', { name: '방문 기록', exact: true }).click();
    await expect(page.getByText('공항 도착 방문을 14:20에 기록했습니다.', { exact: false })).toBeVisible();
    await page.clock.setFixedTime(new Date('2026-12-31T14:30:00Z'));
    await stop(page, '카운트다운 산책').getByRole('button', { name: '방문 기록', exact: true }).click();
    await expect(stop(page, '카운트다운 산책').locator('.record-badge-pill')).toHaveText('방문 23:30');

    await openTab(page, '기록');
    await page
      .locator('article.content-row', { hasText: '카운트다운 산책' })
      .getByRole('button', { name: '정정', exact: true })
      .click();
    await page.getByLabel('날짜', { exact: true }).fill(NEW_YEAR);
    await page.getByLabel('시각 (선택)', { exact: true }).fill('00:30');
    await page.getByLabel('기록 메모').fill('가상 메모: 자정을 넘겨 새해 00:30에 끝남');
    await page.getByRole('button', { name: '실제 기록 저장', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();

    // 12/31 계획 카드의 배지에는 발생일이 붙고, 1/1 타임라인에는 기록 카드가 생긴다. 계획 항목 수는 그대로다.
    await openTab(page, '오늘');
    await selectDayByDate(page, START);
    await expect(stop(page, '카운트다운 산책').locator('.record-badge-pill')).toHaveText('방문 1/1 00:30');
    await expect.poll(() => timelineTitles(page)).toEqual(['공항 도착', '카운트다운 산책']);
    await selectDayByDate(page, NEW_YEAR);
    const moved = page.locator('article.timeline-record', { hasText: '카운트다운 산책' });
    await expect(moved).toBeVisible();
    await expect(moved.getByText('12/31 계획 항목의 기록')).toBeVisible();
    await expect(moved.getByRole('button')).toHaveText(['정정', '기록 탭에서 보기']);
    await expect.poll(() => timelineTitles(page)).toEqual([]);

    // 예정 외 활동은 저장 직후 오늘 타임라인에 기록 카드로 보인다.
    await page.getByRole('button', { name: '예정 외 활동 기록', exact: true }).click();
    await page.getByLabel('활동 이름').fill('편의점 간식');
    await page.getByLabel('날짜', { exact: true }).fill(NEW_YEAR);
    await page.getByLabel('시각 (선택)', { exact: true }).fill('');
    await page.getByLabel('기록 메모').fill('가상 메모: 새해 첫 간식');
    await page.getByRole('button', { name: '실제 기록 저장', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(
      page.getByText('예정 외 활동을 기록했습니다. 아래 타임라인과 `기록` 탭에서 볼 수 있습니다.'),
    ).toBeVisible();
    await expect.poll(() => recordCards(page)).toEqual(['카운트다운 산책', '편의점 간식']);
    await shot(page, 's4-today-records');

    await openTab(page, '기록');
    await expect(page.getByRole('heading', { name: '1월 1일 (금)' })).toBeVisible();
    const countdown = page.locator('article.content-row.record-row', { hasText: '카운트다운 산책' });
    await expect(countdown.locator('summary', { hasText: '정정 1회 · 원문 보기' })).toBeVisible();
    await countdown.getByLabel('기록 더 보기').click();
    await expect(countdown.getByRole('button', { name: '기록 당시 내용', exact: true })).toBeVisible();
    await expect(countdown.getByRole('button', { name: '정정', exact: true })).toBeVisible();
    await shot(page, 's4-records');
  });

  await test.step('S5 · 회고: 버전 이름·배지·계획 설명·날짜 변화', async () => {
    await openTab(page, '기록');
    await page.getByRole('button', { name: '날짜별 회고 보기', exact: true }).click();
    const retro = page.getByRole('region', { name: '날짜별 회고' });
    await expect(retro).toBeVisible();
    await expect(retro.getByText('읽기 전용입니다.', { exact: false })).toBeHidden();
    await retro.getByText('계획 설명', { exact: true }).click();
    await expect(retro.getByText('읽기 전용입니다.', { exact: false })).toBeVisible();

    const select = retro.getByLabel('회고 계획 버전');
    const names = await select.locator('option').allTextContents();
    expect(names[0]).toMatch(/^현재 계획 \(\d\d\/\d\d \d\d:\d\d\)$/);
    for (const name of names.slice(1)) {
      expect(name).toMatch(/^\d\d\/\d\d \d\d:\d\d · .+ · 계획 \d+$/);
    }
    // 1/2 회고: 이동 전 계획과 현재 계획을 견주면 현재 쪽에 `신년 산책`이 이동으로 표시된다.
    await retro.getByLabel('회고 날짜').selectOption(THIRD);
    const beforeMove = names.find((text) => !text.startsWith('현재 계획') && text.includes('가상 숙소 3박 확정'));
    expect(beforeMove, names.join(' | ')).toBeTruthy();
    await select.selectOption({ label: beforeMove! });
    const currentColumn = retro.getByRole('article', { name: /^현재 계획 [0-9]+$/ });
    await expect(currentColumn.locator('li', { hasText: '신년 산책' }).locator('.retro-badge')).toHaveText(
      `이동 (${NEW_YEAR})`,
    );
    await expect(currentColumn.getByText(`변경 이유: ${MOVE_REASON}`)).toBeVisible();
    await shot(page, 's5-retro');
    // 연도 경계 기록: 1/1 회고에는 정정으로 날짜가 바뀐 기록이 보인다.
    await retro.getByLabel('회고 날짜').selectOption(NEW_YEAR);
    await expect(retro.getByText(`정정으로 날짜가 바뀐 기록 · 앞선 단계의 날짜: ${START}`)).toBeVisible();
    await retro.getByLabel('회고 날짜').selectOption(START);
    await expect(retro.getByText(`정정으로 ${NEW_YEAR}(으)로 옮긴 기록입니다.`, { exact: false })).toBeVisible();
  });

  const backup = test.info().outputPath('u4-full-backup.zip');

  await test.step('S6 · 백업: 두 여행 만들기, 전체 백업', async () => {
    await openTripMenu(page);
    await page.getByRole('button', { name: '가상 여행 둘러보기', exact: true }).click();
    await page.getByRole('button', { name: `${OTHER} · 3일`, exact: true }).click();
    await page.getByRole('button', { name: '여행에 추가', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByRole('heading', { name: OTHER, exact: true, level: 1 })).toBeVisible();
    await selectTrip(page, TRIP);
    await backupTo(page, backup);
    // 여행이 있는 공간에서는 복원이 비활성이고 이유와 `새 빈 공간 열기`가 보인다.
    await expect(page.getByLabel('전체 백업 복원')).toBeDisabled();
    await expect(
      page.getByText('이 공간에 여행 2개가 있어 전체 복원을 할 수 없습니다.', { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '새 빈 공간 열기', exact: true })).toBeVisible();
    await shot(page, 's6-restore-disabled');
    await page.getByRole('button', { name: '닫기', exact: true }).click();
  });
  const original = await dump(page, source);
  const originalSapporoId = tripIdOf(original, TRIP);
  const otherId = tripIdOf(original, OTHER);

  await test.step('S6 · 새 빈 공간에서 복원, 두 여행 확인', async () => {
    const { context, target } = await emptyTarget(browser, page, destination);
    try {
      await openStorage(target);
      await target.getByLabel('전체 백업 복원').setInputFiles(backup);
      await expect(target.getByText('복원 미리보기: 2개 여행', { exact: false })).toBeVisible();
      await target.getByRole('button', { name: '확인 후 전체 복원', exact: true }).click();
      await expect(target.getByText('전체 복원 완료.', { exact: false })).toBeVisible();
      await target.getByRole('button', { name: '닫기', exact: true }).click();
      await target.reload();
      const restored = await dump(target, destination);
      expect(counts(restored)).toEqual(counts(original));
      expect(domain(restored, originalSapporoId)).toEqual(domain(original, originalSapporoId));
      expect(domain(restored, otherId)).toEqual(domain(original, otherId));
      await selectTrip(target, TRIP);
      await openTab(target, '오늘');
      await selectDayByDate(target, THIRD);
      await expect.poll(() => timelineTitles(target)).toEqual(['오타루 운하 산책', '신년 산책']);
      await shot(target, 's6-restored');
      await selectTrip(target, OTHER);
      await openTab(target, '오늘');
      await expect(target.getByText('카운트다운 산책')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
