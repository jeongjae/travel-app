import { test, expect, type Page } from '@playwright/test';
import { menuAction, openMore, openTripMenu } from './helpers/nav';

/**
 * C-10〔U2〕 입력 폼 정리. 가상 여행만 쓴다. 저장 명령·스키마는 그대로이고 폼의 칸 구성만 바뀐다.
 * (a) 방문 기록 한 번 누르기 (b) 종료 시각 다음 날 (c) 변경 이유 (d) 시간대 칸 노출 (e) 모바일 저장 버튼.
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
const time = (page: Page) => page.getByLabel('시각 (선택)', { exact: true });

async function createTrip(page: Page, name: string, zone = 'Asia/Tokyo') {
  await openTripMenu(page);
  await page.getByRole('button', { name: '새 여행', exact: true }).click();
  await page.getByLabel('여행 이름').fill(name);
  await page.getByLabel('시작 날짜').fill('2032-06-01');
  await page.getByLabel('종료 날짜').fill('2032-06-03');
  await page.getByLabel('시간대', { exact: false }).fill(zone);
  await page.getByRole('button', { name: '여행 만들기', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible();
}
async function openAddForm(page: Page) {
  await page.getByRole('button', { name: '활동 추가', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}
async function addActivity(page: Page, title: string, clock?: string, end?: string) {
  await openAddForm(page);
  await page.getByLabel('활동 제목').fill(title);
  if (clock) {
    await time(page).fill(clock);
  }
  if (end) {
    await page.getByLabel('종료 시각 (선택)').fill(end);
  }
  await page.getByRole('button', { name: '계획 저장', exact: true }).click();
}
const stop = (page: Page, title: string) => page.locator('article.timeline-stop', { hasText: title });

test('활동 추가 폼: 칸 순서는 제목→장소→날짜→시각→종료 시각이고 발생 날짜·정밀도·시간대 칸은 화면에 없다', async ({
  page,
}) => {
  await page.goto(space('u2-form'));
  await createTrip(page, '가상 폼 여행');
  await openAddForm(page);
  const dialog = page.getByRole('dialog');
  const labels = await dialog
    .locator('form > label')
    .evaluateAll((nodes) => nodes.map((node) => (node.firstChild?.textContent ?? '').trim()));
  expect(labels).toEqual(['활동 제목', '연결할 장소', '계획 날짜', '시각 (선택)', '종료 시각 (선택)']);
  await expect(dialog.getByLabel('발생 날짜')).toHaveCount(0);
  await expect(dialog.getByLabel('IANA 시간대')).toHaveCount(0);
  await expect(dialog.getByLabel('시간대 (예: Asia/Tokyo)')).toHaveCount(0);
  // 정밀도 선택 상자는 `자세히` 접기 안에 있고 열기 전에는 보이지 않는다.
  await expect(dialog.getByLabel('시각 정밀도')).not.toBeVisible();
  await dialog.getByText('자세히', { exact: true }).click();
  await expect(dialog.getByLabel('시각 정밀도')).toBeVisible();
  await expect(dialog.getByText('시간대: Asia/Tokyo (여행 기본)')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('add-form.png') });
});

test('(a) 방문 기록은 한 번 누르면 여행 시간대의 현재 시각으로 바로 저장되고 정정할 수 있다', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2032-06-01T05:20:00Z'));
  await page.goto(space('u2-visit'));
  await createTrip(page, '가상 방문 여행');
  await addActivity(page, '가상 산책', '14:00');
  await expect(page.getByRole('dialog')).not.toBeVisible();

  await stop(page, '가상 산책').getByRole('button', { name: '방문 기록', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const toast = page.getByRole('status').filter({ hasText: '가상 산책 방문을 14:20에 기록했습니다.' });
  await expect(toast).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('visit-toast.png') });

  await nav(page).getByRole('button', { name: '기록', exact: true }).click();
  const row = page.locator('article.content-row', { hasText: '가상 산책' });
  // local 정밀도 · 여행 시간대 · 현재 시각(14:20, 도쿄)
  await expect(row).toContainText('2032-06-01 14:20 · Asia/Tokyo');
  await row.getByRole('button', { name: '정정', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('날짜', { exact: true })).toHaveValue('2032-06-01');
  await expect(time(page)).toHaveValue('14:20');
  await time(page).fill('14:35');
  await page.getByLabel('기록 메모').fill('가상 메모: 정정');
  await page.screenshot({ path: test.info().outputPath('correct-form.png') });
  await page.getByRole('button', { name: '실제 기록 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('정정 2/2단계 · 최신 정정본', { exact: false })).toBeVisible();
  await expect(page.locator('article.content-row', { hasText: '가상 메모: 정정' })).toContainText('14:35');
});

test('(b) 종료 시각이 시작보다 이르면 다음 날로 저장할지 묻고 타임라인에 (다음 날)로 보인다', async ({ page }) => {
  await page.goto(space('u2-end'));
  await createTrip(page, '가상 종료 시각 여행');
  await addActivity(page, '가상 야경', '23:30', '00:30');
  const ask = page.getByRole('group', { name: '다음 날 확인' });
  await expect(ask).toContainText('다음 날 00:30');
  await page.screenshot({ path: test.info().outputPath('next-day-ask.png') });
  await ask.getByRole('button', { name: '다음 날로 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(stop(page, '가상 야경').locator('.timeline-time')).toHaveText('23:30 ~ 00:30 (다음 날)');

  // 같은 날 안의 종료 시각은 확인 없이 저장되고 표시에 (다음 날)이 없다.
  await addActivity(page, '가상 저녁', '18:00', '19:00');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(stop(page, '가상 저녁').locator('.timeline-time')).toHaveText('18:00 ~ 19:00');
});

test('(c) 일정 수정의 변경 이유가 계획 버전에 남아 회고에서 보인다. 비우면 기본 문구다', async ({ page }) => {
  await page.goto(space('u2-reason'));
  await createTrip(page, '가상 변경 이유 여행');
  await addActivity(page, '가상 박물관', '10:00');
  await expect(stop(page, '가상 박물관')).toBeVisible();

  const edit = async (reason: string) => {
    await menuAction(stop(page, '가상 박물관'), '일정 수정');
    await time(page).fill(reason ? '11:00' : '12:00');
    if (reason) {
      await page.getByLabel('변경 이유 (선택)').fill(reason);
    }
    await page.screenshot({ path: test.info().outputPath('edit-form.png') });
    await page.getByRole('button', { name: '계획 저장', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  };
  await edit('비가 와서 한 시간 늦춤');
  await edit('');

  await openMore(page, '계획 버전');
  // 계획 버전 목록에 변경 이유가 남는다: 활동 추가(1) → 이유 입력 수정(2) → 이유 비움 수정(3) 순이다.
  const versions = page.locator('option', { hasText: '계획 ' });
  await expect(versions.filter({ hasText: '비가 와서 한 시간 늦춤' })).toHaveCount(1);
  await expect(versions.filter({ hasText: '사용자 일정 수정' })).toHaveCount(2);
  // 수정 폼에만 변경 이유 칸이 있다. 새 활동 추가에는 없다.
  await nav(page).getByRole('button', { name: '오늘', exact: true }).click();
  await openAddForm(page);
  await expect(page.getByLabel('변경 이유 (선택)')).toHaveCount(0);
});

test('(d) 여행 시간대를 모르면 시각을 넣을 때 시간대 칸이 보이고, 알면 보이지 않는다', async ({ page }) => {
  await page.goto(space('u2-zone'));
  await createTrip(page, '가상 시간대 미정 여행', '');
  await openAddForm(page);
  await expect(page.getByLabel('시간대 (예: Asia/Tokyo)')).toHaveCount(0);
  await time(page).fill('09:00');
  await expect(page.getByLabel('시간대 (예: Asia/Tokyo)')).toBeVisible();
  await page.getByRole('button', { name: '닫기', exact: true }).click();

  await page.goto(space('u2-zone-known'));
  await createTrip(page, '가상 시간대 확인 여행', 'Asia/Tokyo');
  await openAddForm(page);
  await time(page).fill('09:00');
  await expect(page.getByLabel('시간대 (예: Asia/Tokyo)')).toHaveCount(0);
});

test('(e) 긴 폼에서도 저장 버튼과 닫기 버튼이 스크롤 없이 보인다', async ({ page }) => {
  await page.goto(space('u2-sticky'));
  await createTrip(page, '가상 고정 버튼 여행');
  await addActivity(page, '가상 일정', '10:00');
  await menuAction(stop(page, '가상 일정'), '일정 수정');
  const dialog = page.getByRole('dialog');
  await dialog.getByText('자세히', { exact: true }).click();
  await expect(dialog.getByRole('button', { name: '계획 저장', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(dialog.getByRole('button', { name: '닫기', exact: true })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: test.info().outputPath('sticky-actions.png') });
  // 폼 끝으로 스크롤해도 같다.
  await dialog.evaluate((node) => node.scrollTo(0, node.scrollHeight));
  await expect(dialog.getByRole('button', { name: '계획 저장', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(dialog.getByRole('button', { name: '닫기', exact: true })).toBeInViewport({ ratio: 1 });
});

test('숙박 폼: 날짜·시각 순서를 맞추고 시간대는 여행 기본값을 쓰며 저장 버튼이 고정된다', async ({ page }) => {
  await page.goto(space('u2-stay'));
  await createTrip(page, '가상 숙박 여행');
  await page.getByRole('button', { name: '숙박 추가', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const labels = await dialog
    .locator('form > label')
    .evaluateAll((nodes) => nodes.map((node) => (node.firstChild?.textContent ?? '').trim()));
  expect(labels.slice(0, 6)).toEqual([
    '숙박 이름·거점',
    '지역 (선택)',
    '입실 날짜',
    '입실 시각 (선택)',
    '퇴실 날짜',
    '퇴실 시각 (선택)',
  ]);
  await expect(dialog.getByLabel('시간대 (확인한 경우만)')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '숙박 저장', exact: true })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: test.info().outputPath('stay-form.png') });
});
