import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { dump, domain, counts, tripIdOf, spaceIds, type Dump } from './helpers/space-dump';

/**
 * C-07〔T-C8〕 삿포로 가상 여행 대본 리허설. `docs/c07-sapporo-scenario.md`의 단계 번호(S1~S7)를 그대로 따른다.
 * 모든 장소·설명·일정은 가상 자료다. 사용자 공간·실제 ZIP은 쓰지 않고 검토 공간 이름은 프로젝트마다 따로 둔다.
 * 백업 파일은 경로로 전달한다. 사용자가 실제로 파일 선택 창에서 고르는 방식과 같고 CL-16 수정(취소 이벤트 무시)을 함께 확인한다.
 */
// 화면 문구가 어긋나면 단계 전체를 기다리지 않고 해당 동작에서 바로 실패하게 한다.
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
const PRACTICAL = '가상 메모·미확인: 운영 시간과 요금은 확인하지 않음';

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
async function selectTrip(page: Page, name: string) {
  await expand(page, '.journey-library');
  await page.getByRole('navigation', { name: '여행 선택' }).getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible();
}
async function selectDay(page: Page, date: string) {
  const select = page.getByLabel('날짜', { exact: true });
  const value = await select
    .locator('option')
    .evaluateAll((nodes, wanted) => nodes.find((n) => n.textContent?.startsWith(wanted))?.getAttribute('value'), date);
  expect(value, `날짜 ${date}`).toBeTruthy();
  await select.selectOption(value!);
}
const timelineTitles = (page: Page) => page.locator('.day-timeline h3').allTextContents();
const row = (page: Page, title: string): Locator => page.locator('article.content-row', { hasText: title });
const space = (name: string) => `/?workspace=content&review=${name}`;
/** 일정 항목 카드. 이동 안내 문구에 다른 활동 제목이 들어 있으므로 제목(h3)으로 고른다. */
const stop = (page: Page, title: string): Locator =>
  page.locator('article.timeline-stop').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
const regionLine = (page: Page) => page.locator('.stay-leg-editing .muted').first();

/** 시각 입력 상자: 현지 시각 + 도쿄 시간대. */
async function setLocalTime(page: Page, date: string, time: string) {
  await page.getByLabel('시각 정밀도').selectOption('local');
  await page.getByLabel('발생 날짜').fill(date);
  await page.locator('input[type=time]').fill(time);
  await page.getByLabel('IANA 시간대').fill(ZONE);
}
async function setDateOnly(page: Page, date: string) {
  await page.getByLabel('시각 정밀도').selectOption({ label: '날짜만 확인' });
  await page.getByLabel('발생 날짜').fill(date);
}

// ───────── S1 ─────────
async function createTrip(page: Page) {
  await expand(page, '.journey-library');
  await page.getByRole('button', { name: '새 여행', exact: true }).click();
  await page.getByLabel('여행 이름').fill(TRIP);
  await page.getByLabel('시작 날짜').fill(START);
  await page.getByLabel('종료 날짜').fill(END);
  await page.getByLabel('시간대 (확인한 경우만)').fill(ZONE);
  await page.getByRole('button', { name: '여행 만들기', exact: true }).click();
  await expect(page.getByRole('heading', { name: TRIP, exact: true, level: 1 })).toBeVisible();
}

// ───────── S2 ─────────
async function addRegion(page: Page, name: string, description: string) {
  await openTab(page, '가이드');
  await page.getByRole('button', { name: '지역 작성', exact: true }).click();
  await page.getByLabel('지역 이름').fill(name);
  await page.getByLabel('지역 설명').fill(description);
  await page.getByRole('button', { name: '지역 저장', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true, level: 2 })).toBeVisible();
}
async function addPlace(page: Page, name: string, region: string, summary: string, why: string) {
  await openTab(page, '가이드');
  await page.getByRole('button', { name: '장소 작성', exact: true }).click();
  await page.getByLabel('장소 이름').fill(name);
  await page.getByLabel('한 줄 요약').fill(summary);
  await page.getByLabel(region, { exact: true }).check();
  await page.getByLabel('왜 가는가 (필수)').fill(why);
  await page.getByLabel('실용 정보').fill(PRACTICAL);
  await page.getByRole('button', { name: '장소 저장', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true, level: 2 })).toBeVisible();
}
async function writeRegionGuide(page: Page) {
  await page.getByRole('button', { name: '지역 가이드 작성', exact: true }).click();
  await page.getByLabel('가이드 제목').fill('겨울 도시 걷기 안내');
  await page.getByLabel('섹션 1 제목').fill('눈길 걷기');
  await page.getByLabel('섹션 1 본문').fill('가상 안내: 미끄럼 방지 신발을 챙긴다.');
  await page.getByRole('button', { name: '섹션 추가', exact: true }).click();
  await page.getByLabel('섹션 2 제목').fill('실내 쉼터');
  await page.getByLabel('섹션 2 본문').fill('가상 안내: 추우면 역 근처 지하보도로 이동한다.');
  await page.getByRole('button', { name: '가이드 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}
const PLACES: [string, string, string, string][] = [
  ['신치토세 공항', '삿포로', '도착 후 시내로 가는 관문', '첫날 도착 지점'],
  ['삿포로 역', '삿포로', '시내 이동의 중심 역', '근교 이동의 출발점'],
  ['오도리 공원', '삿포로', '도심 한가운데의 긴 공원', '연말 밤 산책 후보'],
  ['삿포로 시계탑', '삿포로', '오래된 시계탑 건물', '짧게 들를 수 있는 명소'],
  ['스스키노', '삿포로', '저녁 식사 거리', '둘째 날 저녁 후보'],
  ['오타루 운하', '오타루', '근교 운하 산책길', '당일치기 근교 후보'],
];

// ───────── S3 ─────────
async function addActivity(page: Page, title: string, options: { place?: string; date: string; time?: string }) {
  await openTab(page, '오늘');
  await page.getByRole('button', { name: '활동 추가', exact: true }).click();
  if (options.place) {
    await page.getByLabel('연결할 장소').selectOption({ label: options.place });
  }
  await page.getByLabel('활동 제목').fill(title);
  await page.getByLabel('계획 날짜').selectOption({ label: options.date });
  if (options.time) {
    await setLocalTime(page, options.date, options.time);
  }
  await page.getByRole('button', { name: '계획 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}
async function addLeg(page: Page, date: string, from: string, to: string, mode: string, duration: string, why: string) {
  await openTab(page, '오늘');
  await selectDay(page, date);
  await page.getByRole('button', { name: '이동 추가', exact: true }).click();
  await page.getByLabel('출발 활동').selectOption({ label: from });
  await page.getByLabel('도착 활동').selectOption({ label: to });
  await page.getByLabel('이동 수단').fill(mode);
  await page.getByLabel('소요 시간 (선택)').fill(duration);
  await page.getByLabel('변경 이유').fill(why);
  await page.getByRole('button', { name: '이동 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}
const SCHEDULE: [string, string, { place?: string; date: string; time?: string }][] = [
  ['공항 도착', START, { place: '신치토세 공항', date: START, time: '14:00' }],
  ['호텔 체크인', START, { date: START }],
  ['카운트다운 산책', START, { place: '오도리 공원', date: START, time: '23:30' }],
  ['시계탑 방문', NEW_YEAR, { place: '삿포로 시계탑', date: NEW_YEAR }],
  ['스스키노 저녁', NEW_YEAR, { place: '스스키노', date: NEW_YEAR }],
  ['삿포로역 출발', THIRD, { place: '삿포로 역', date: THIRD }],
  ['오타루 운하 산책', THIRD, { place: '오타루 운하', date: THIRD }],
  ['호텔 체크아웃', END, { date: END }],
  ['공항으로 이동', END, { place: '신치토세 공항', date: END }],
];

// ───────── S4 ─────────
async function recordFor(page: Page, button: '방문 기록' | '건너뜀 기록', title: string) {
  await stop(page, title).getByRole('button', { name: button, exact: true }).click();
}
async function saveRecord(page: Page) {
  await page.getByRole('button', { name: '실제 기록 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}
async function recordUnplanned(page: Page, title: string, date: string, note: string) {
  await openTab(page, '오늘');
  await page.getByRole('button', { name: '예정 외 활동 기록', exact: true }).click();
  await page.getByLabel('활동 이름').fill(title);
  await setDateOnly(page, date);
  await page.getByLabel('기록 메모').fill(note);
  await saveRecord(page);
}
/** 현재 메모 문구로 최신 정정본 행을 찾아 정정한다(정정마다 메모를 바꾸므로 행을 구분할 수 있다). */
async function correctRecord(page: Page, currentNote: string, edit: { date?: string; time?: string; note: string }) {
  await page
    .locator('article.content-row', { hasText: currentNote })
    .getByRole('button', { name: '정정', exact: true })
    .click();
  if (edit.date) {
    await page.getByLabel('발생 날짜').fill(edit.date);
  }
  if (edit.time) {
    await page.locator('input[type=time]').fill(edit.time);
  }
  await page.getByLabel('기록 메모').fill(edit.note);
  await saveRecord(page);
}

// ───────── S5 ─────────
async function openRetro(page: Page) {
  await openExtra(page, '실제 기록');
  await page.getByRole('button', { name: '날짜별 회고 보기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '날짜별 회고', exact: true })).toBeVisible();
  return page.getByRole('region', { name: '날짜별 회고' });
}
async function expectRetroContent(page: Page) {
  const retro = await openRetro(page);
  // 연도 경계: 날짜 목록은 연도를 넘어 오름차순이다.
  const dates = await retro
    .getByLabel('회고 날짜')
    .locator('option')
    .evaluateAll((nodes) => nodes.map((n) => (n as HTMLOptionElement).value));
  const calendar = dates.filter((value) => /^[0-9]{4}-/.test(value));
  expect(calendar.slice(0, 4)).toEqual([START, NEW_YEAR, THIRD, END]);
  expect([...calendar].sort()).toEqual(calendar);

  // 2027-01-01: 12/31 23:30으로 남긴 기록을 정정으로 옮겨 온 최신 정정본이 대표다.
  await retro.getByLabel('회고 날짜').selectOption(NEW_YEAR);
  await expect(retro.getByRole('heading', { name: '카운트다운 산책', level: 4 })).toBeVisible();
  await expect(retro.getByText(`정정으로 날짜가 바뀐 기록 · 앞선 단계의 날짜: ${START}`)).toBeVisible();
  await expect(retro.getByText(`계획일 ${START} · 실제 날짜 ${NEW_YEAR}와 다름`, { exact: false })).toBeVisible();
  await expect(retro.getByText(`${NEW_YEAR} 00:30`, { exact: false }).first()).toBeVisible();
  await retro.getByText('정정 3단계 원문 보기').click();
  await expect(retro.getByText('원본 · 카운트다운 산책', { exact: false })).toBeVisible();
  await expect(retro.getByText('최신 정정본 · 카운트다운 산책', { exact: false })).toBeVisible();

  // 2026-12-31: 같은 기록의 원문이 여기 남아 있고 옮겨진 날짜를 알려 준다. 12/31에 한 다른 기록은 그대로 남는다.
  await retro.getByLabel('회고 날짜').selectOption(START);
  await expect(retro.getByText(`정정으로 ${NEW_YEAR}(으)로 옮긴 기록입니다.`, { exact: false })).toBeVisible();
  await expect(retro.getByRole('heading', { name: '공항 도착', level: 4 })).toBeVisible();
  await expect(retro.getByText('방문', { exact: false }).first()).toBeVisible();
}

// ───────── S6 ─────────
async function seedOther(page: Page) {
  await expand(page, '.journey-library');
  await page.getByRole('button', { name: '가상 여행 둘러보기', exact: true }).click();
  await page.getByRole('button', { name: `${OTHER} · 3일`, exact: true }).click();
  await page.getByRole('button', { name: '여행에 추가', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('heading', { name: OTHER, exact: true, level: 1 })).toBeVisible();
}
async function backupTo(page: Page, file: string) {
  await page.getByRole('button', { name: '저장소·백업', exact: true }).click();
  await page.getByRole('button', { name: '전체 백업 만들기', exact: true }).click();
  await expect(page.getByText('전체 백업 생성 완료', { exact: false })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('link', { name: '검증한 전체 백업 파일 저장' }).click();
  await (await downloaded).saveAs(file);
  await page.getByRole('button', { name: '닫기', exact: true }).click();
}
async function emptyTarget(browser: Browser, page: Page, review: string) {
  const context = await browser.newContext({ viewport: page.viewportSize() ?? undefined, serviceWorkers: 'allow' });
  const target = await context.newPage();
  await target.route('**/api/ai/v2/status', (route) => route.fulfill({ json: { configured: false } }));
  await target.goto(`http://127.0.0.1:4173${space(review)}`);
  await expect(target.getByText('검증용 저장소', { exact: false })).toBeVisible();
  return { context, target };
}
async function restoreFrom(page: Page, file: string) {
  await page.getByRole('button', { name: '저장소·백업', exact: true }).click();
  await page.getByLabel('전체 백업 파일 선택').setInputFiles(file);
  await expect(page.getByText('복원 미리보기: 2개 여행', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '확인 후 전체 복원', exact: true }).click();
  await expect(page.getByText('전체 복원 완료.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.reload();
}
/** 삿포로 여행의 준비·계획·기록·회고를 화면에서 다시 읽는다. 원본 공간과 복원 공간에서 같은 검사를 쓴다. */
async function readSapporo(page: Page) {
  await selectTrip(page, TRIP);
  await openTab(page, '가이드');
  await page.getByLabel('이름·지역 검색').fill('시계탑');
  await expect(page.getByRole('button', { name: '삿포로 시계탑', exact: true })).toBeVisible();
  await page.getByLabel('이름·지역 검색').fill('');
  await page.getByRole('button', { name: '삿포로', exact: true }).click();
  await expect(page.getByRole('heading', { name: '겨울 도시 걷기 안내', exact: true, level: 3 })).toBeVisible();
  await expect(page.getByText('가상 안내: 미끄럼 방지 신발을 챙긴다.', { exact: true })).toBeVisible();
  await openTab(page, '오늘');
  await selectDay(page, THIRD);
  await expect.poll(() => timelineTitles(page)).toEqual(['삿포로역 출발', '오타루 운하 산책', '시계탑 방문']);
  await expect(regionLine(page)).toContainText('하루 지역 삿포로 · 밤을 보내는 지역 삿포로');
  await selectDay(page, START);
  await expect(page.getByText('이동 공항 도착 → 호텔 체크인 · JR 쾌속 에어포트', { exact: false })).toBeVisible();
  await expectRetroContent(page);
}

test('삿포로 가상 여행 대본: 준비→계획 변경→현장 기록(연도 경계)→회고→두 여행 백업·빈 공간 복원', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const project = test.info().project.name;
  const source = `c07-src-${project}`;
  const destination = `c07-dst-${project}`;

  await test.step('S1 · C-S1 지역 없는 새 여행 만들기', async () => {
    await page.goto(space(source));
    await createTrip(page);
    await openTab(page, '전체 일정');
    await expect(page.locator('.journey-card')).toHaveCount(4);
    await openTab(page, '가이드');
    await expect(page.getByText('아직 지역이나 장소가 없습니다.', { exact: false })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: TRIP, exact: true, level: 1 })).toBeVisible();
    await openTab(page, '전체 일정');
    await expect(page.locator('.journey-card')).toHaveCount(4);
    await expect(page.locator('.journey-card').first()).toContainText(START);
    await expect(page.locator('.journey-card').last()).toContainText(END);
  });

  await test.step('S2 · C-S2 지역·장소 6개·지역 가이드 작성, 찾기, 재실행 후 읽기', async () => {
    await addRegion(page, '삿포로', '가상 설명: 겨울에 걷기 좋은 홋카이도 중심 도시');
    await writeRegionGuide(page);
    await expect(page.getByRole('heading', { name: '겨울 도시 걷기 안내', exact: true, level: 2 })).toBeVisible();
    await page.getByRole('button', { name: '이전 안내로', exact: true }).click();
    await page.getByRole('button', { name: '목록으로', exact: true }).click();
    await addRegion(page, '오타루', '가상 설명: 삿포로에서 당일로 다녀오는 근교 항구 도시');
    await page.getByRole('button', { name: '목록으로', exact: true }).click();
    for (const [name, region, summary, why] of PLACES) {
      await addPlace(page, name, region, summary, why);
    }
    await openTab(page, '가이드');
    await page.getByLabel('이름·지역 검색').fill('오타루');
    await expect(page.getByRole('button', { name: '오타루 운하', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '삿포로 시계탑', exact: true })).toHaveCount(0);
    await page.reload();
    await openTab(page, '가이드');
    await page.getByLabel('이름·지역 검색').fill('');
    await page.getByRole('button', { name: '삿포로 시계탑', exact: true }).click();
    await expect(page.getByText(PRACTICAL, { exact: true })).toBeVisible();
  });

  await test.step('S3 · C-S3 활동 연결·시간, 숙박 3박, 이동', async () => {
    for (const [title, , options] of SCHEDULE) {
      await addActivity(page, title, options);
    }
    await openTab(page, '오늘');
    await selectDay(page, START);
    await expect.poll(() => timelineTitles(page)).toEqual(['공항 도착', '호텔 체크인', '카운트다운 산책']);
    await expect(page.locator('.timeline-time')).toHaveText(['14:00', '시각 미정', '23:30']);
    await page.getByRole('button', { name: '숙박 추가', exact: true }).click();
    await page.getByLabel('숙박 이름·거점').fill('가상 시내 호텔');
    await page.getByLabel('지역 (선택)').selectOption({ label: '삿포로' });
    await page.getByLabel('입실 날짜').fill(START);
    await page.getByLabel('퇴실 날짜').fill(END);
    await page.getByLabel('시간대 (확인한 경우만)').fill(ZONE);
    await page.getByLabel('변경 이유').fill('가상 숙소 3박 확정');
    await page.getByRole('button', { name: '숙박 저장', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(regionLine(page)).toContainText('하루 지역 삿포로 · 밤을 보내는 지역 삿포로');
    await selectDay(page, END);
    await expect(regionLine(page)).toContainText('하루 지역 삿포로 · 밤을 보내는 지역 없음');
    await addLeg(page, START, '공항 도착', '호텔 체크인', 'JR 쾌속 에어포트', '약 40분', '공항에서 시내로 이동(가상)');
    await addLeg(page, THIRD, '삿포로역 출발', '오타루 운하 산책', 'JR 쾌속', '약 40분', '근교 당일치기 이동(가상)');
    await openTab(page, '전체 일정');
    await expect(page.getByText('지역 삿포로 · 숙박 지역 삿포로', { exact: false }).first()).toBeVisible();
  });

  const beforeChange = await dump(page, source);
  const sapporoId = tripIdOf(beforeChange, TRIP);
  const planRowsBefore = beforeChange.tables.plan_versions.filter((r) => r.tripId === sapporoId);

  await test.step('S3 · 계획 변경 1회(연휴 휴무 가정으로 방문일 이동)와 이전 버전 보존', async () => {
    await openTab(page, '오늘');
    await selectDay(page, NEW_YEAR);
    await row(page, '시계탑 방문').getByRole('button', { name: '일정 수정', exact: true }).click();
    await page.getByLabel('계획 날짜').selectOption({ label: THIRD });
    await page.getByRole('button', { name: '계획 저장', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect.poll(() => timelineTitles(page)).toEqual(['스스키노 저녁']);
    await selectDay(page, THIRD);
    await expect.poll(() => timelineTitles(page)).toEqual(['삿포로역 출발', '오타루 운하 산책', '시계탑 방문']);
    // 가상 사유는 활동 메모로 남긴다(일정 수정의 변경 이유는 화면에서 입력하지 않는다).
    await stop(page, '시계탑 방문').getByRole('button', { name: '메모', exact: true }).click();
    await page.getByLabel('메모 본문').fill('가상 가정: 1월 1일은 휴무라 1월 2일로 옮김');
    await page.getByRole('button', { name: '메모 저장', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();

    const after = await dump(page, source);
    const planRowsAfter = after.tables.plan_versions.filter((r) => r.tripId === sapporoId);
    expect(planRowsAfter).toHaveLength(planRowsBefore.length + 1);
    // 이전 계획 버전 행은 그대로 남는다.
    const key = (r: Record<string, unknown>) => JSON.stringify(r);
    const afterKeys = new Set(planRowsAfter.map(key));
    for (const r of planRowsBefore) {
      expect(afterKeys.has(key(r))).toBe(true);
    }
  });

  await test.step('S4 · 연도 경계 활동의 계획·실제 기록과 정정 2회', async () => {
    await openTab(page, '오늘');
    await selectDay(page, START);
    await recordFor(page, '방문 기록', '공항 도착');
    await setLocalTime(page, START, '14:20');
    await page.getByLabel('기록 메모').fill('가상 메모: 눈이 내려 도착이 조금 늦음');
    await saveRecord(page);
    await recordFor(page, '방문 기록', '카운트다운 산책');
    await setLocalTime(page, START, '23:30');
    await page.getByLabel('기록 메모').fill('가상 메모: 자정 직전에 산책 시작');
    await saveRecord(page);
    await openExtra(page, '실제 기록');
    await correctRecord(page, '자정 직전에 산책 시작', {
      date: NEW_YEAR,
      time: '00:30',
      note: '가상 메모: 자정을 넘겨 새해 00:30에 끝남',
    });
    await correctRecord(page, '자정을 넘겨 새해 00:30에 끝남', {
      note: '가상 메모: 정정 2회차, 사람이 많아 늦게 끝남',
    });
    await expect(page.getByText('정정 3/3단계 · 최신 정정본', { exact: false })).toBeVisible();
    await expect(page.getByText('정정 1/3단계 · 이후 정정본 있음', { exact: false })).toBeVisible();
  });

  await test.step('S4 · 건너뜀·예정 외 활동·여행 메모와 오프라인 저장', async () => {
    await openTab(page, '오늘');
    await selectDay(page, THIRD);
    await recordFor(page, '건너뜀 기록', '오타루 운하 산책');
    await setDateOnly(page, THIRD);
    await page.getByLabel('기록 메모').fill('가상 메모: 눈보라로 건너뜀');
    await saveRecord(page);
    await recordUnplanned(page, '편의점 간식', NEW_YEAR, '가상 메모: 새해 첫 간식');
    await openExtra(page, '실제 기록');
    await page.getByRole('button', { name: '여행 메모 쓰기', exact: true }).click();
    await page.getByLabel('메모 본문').fill('가상 여행 메모: 눈길에는 걸음을 천천히');
    await page.getByRole('button', { name: '메모 저장', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();

    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.waitForTimeout(400);
    await page.context().setOffline(true);
    await page.reload();
    await recordUnplanned(page, '오프라인 눈길 메모', THIRD, '가상 메모: 오프라인 저장 확인');
    await page.reload();
    await openExtra(page, '실제 기록');
    await expect(row(page, '오프라인 눈길 메모')).toBeVisible();
    await expect(page.getByText('가상 여행 메모: 눈길에는 걸음을 천천히', { exact: true })).toBeVisible();
    await page.context().setOffline(false);
    await expect(row(page, '오타루 운하 산책').getByText('건너뜀', { exact: false }).first()).toBeVisible();
    await expect(row(page, '편의점 간식')).toBeVisible();
  });

  await test.step('S5 · C-S5 날짜별 회고(당시/현재 계획·실제·정정·변경 이유)', async () => {
    await expectRetroContent(page);
    const retro = page.getByRole('region', { name: '날짜별 회고' });
    // 시계탑 방문: 이동 전 계획에서는 1/1, 현재 계획에서는 1/2.
    await retro.getByLabel('회고 날짜').selectOption(NEW_YEAR);
    const options = await retro.getByLabel('회고 계획 버전').locator('option').allTextContents();
    const earlier = options.find((text) => text.startsWith('과거 계획') && text.includes('근교 당일치기 이동(가상)'));
    expect(earlier, options.join(' | ')).toBeTruthy();
    await retro.getByLabel('회고 계획 버전').selectOption({ label: earlier! });
    await expect(
      retro.getByRole('article', { name: /^과거 계획 [0-9]+$/ }).getByText('시계탑 방문', { exact: false }),
    ).toBeVisible();
    await expect(retro.getByRole('article', { name: /^현재 계획 [0-9]+$/ }).getByText('시계탑 방문')).toHaveCount(0);
    await retro.getByLabel('회고 날짜').selectOption(THIRD);
    await expect(
      retro.getByRole('article', { name: /^현재 계획 [0-9]+$/ }).getByText('시계탑 방문', { exact: false }),
    ).toBeVisible();
    await expect(
      retro.getByRole('article', { name: /^현재 계획 [0-9]+$/ }).getByText('변경 이유(계획 전체): 사용자 일정 수정'),
    ).toBeVisible();
    await expect(retro.getByText('근거 없음', { exact: false }).first()).toBeVisible();
  });

  await test.step('S6 · C-S6 기존 여행을 더하고 전체 백업', async () => {
    await seedOther(page);
    await selectTrip(page, TRIP);
  });
  const original = await dump(page, source);
  const originalSapporoId = tripIdOf(original, TRIP);
  const otherId = tripIdOf(original, OTHER);
  const backup = test.info().outputPath('c07-full-backup.zip');
  await backupTo(page, backup);

  await test.step('S6 · 빈 검토 공간 복원과 두 여행 재조회·누출 없음', async () => {
    const { context, target } = await emptyTarget(browser, page, destination);
    try {
      await restoreFrom(target, backup);
      const restored = await dump(target, destination);
      expect(counts(restored)).toEqual(counts(original));
      expect(domain(restored)).toEqual(domain(original));
      expect(domain(restored, originalSapporoId)).toEqual(domain(original, originalSapporoId));
      expect(domain(restored, otherId)).toEqual(domain(original, otherId));
      expect(spaceIds(restored).size).toBe(1);
      expect([...spaceIds(restored)][0]).not.toEqual([...spaceIds(original)][0]);
      const assetKey = (a: Dump['assets'][number]) =>
        [`${a.tripId}/${a.sha256}`, a.byteLength, a.actualSha256, a.actualSize, a.verified].join('|');
      expect(restored.assets.map(assetKey).sort()).toEqual(original.assets.map(assetKey).sort());
      expect(restored.assets.length).toBeGreaterThan(0);
      // 삿포로 여행에는 첨부가 없고, 가져온 여행의 첨부는 그 여행에만 속한다.
      expect(restored.assets.every((a) => a.tripId === otherId)).toBe(true);

      await target.getByRole('button', { name: '저장소·백업', exact: true }).click();
      await expect(target.getByLabel('전체 백업 파일 선택')).toBeDisabled();
      await target.getByRole('button', { name: '닫기', exact: true }).click();

      await readSapporo(target);
      // 다른 여행: 삿포로 내용이 보이지 않고 자기 내용이 그대로다.
      await selectTrip(target, OTHER);
      await openTab(target, '가이드');
      await expect(target.getByRole('button', { name: '삿포로 시계탑', exact: true })).toHaveCount(0);
      await openTab(target, '오늘');
      await expect(target.getByText('카운트다운 산책')).toHaveCount(0);
      await target.reload();
      await selectTrip(target, TRIP);
      await openTab(target, '오늘');
      await expect(target.locator('.day-page').getByText(OTHER)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
