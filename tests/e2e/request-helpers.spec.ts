import { test, expect, type Locator, type Page } from '@playwright/test';
import { currentDate, openTripMenu, planVersionSelect } from './helpers/nav';

/** T-E3-1: 날짜 화면의 "AI에게 요청"(A), 요청 종류(B), 스타일 프리셋(C), 지난번 답(D). 가상 값만 쓴다. */
const CAPTURE_DIR = process.env.E3_CAPTURE_DIR;

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
const TRIP = '가상 요청 도우미 여행';

async function createTrip(page: Page) {
  await openTripMenu(page);
  await page.getByRole('button', { name: '새 여행', exact: true }).click();
  await page.getByLabel('여행 이름').fill(TRIP);
  await page.getByLabel('시작 날짜').fill('2032-06-01');
  await page.getByLabel('종료 날짜').fill('2032-06-03');
  await page.getByLabel('시간대', { exact: false }).fill('Asia/Tokyo');
  await page.getByRole('button', { name: '여행 만들기', exact: true }).click();
  await expect(page.getByRole('heading', { name: TRIP, exact: true, level: 1 })).toBeVisible();
}

async function openBrief(page: Page) {
  await openTripMenu(page);
  await page.getByRole('button', { name: 'AI로 계획 만들기', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'AI로 계획 만들기' })).toBeVisible();
}

function chip(group: Locator, name: string) {
  return group.getByRole('button', { name, exact: true });
}

test('A: 날짜 화면에서 "AI에게 요청"을 누르면 그 날짜만 담아 열리고, 창에서 넓힐 수 있다', async ({ page }) => {
  await page.goto(space('e3-a'));
  await createTrip(page);
  const date = await currentDate(page);
  expect(date).toMatch(/^2032-06-0[1-3]$/);
  const ask = page.locator('.day-toolbar').getByRole('button', { name: 'AI에게 요청', exact: true });
  await expect(ask).toBeEnabled();
  if (CAPTURE_DIR) {
    await page.screenshot({ path: `${CAPTURE_DIR}/day-toolbar-${test.info().project.name}.png` });
  }
  await ask.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('export-counts')).toBeVisible();
  await expect(dialog.getByRole('radio', { name: '날짜 범위' })).toBeChecked();
  await expect(dialog.getByLabel('시작')).toHaveValue(date!);
  await expect(dialog.getByLabel('끝')).toHaveValue(date!);
  const text = dialog.getByLabel('나가는 글');
  await expect(text).toHaveValue(new RegExp(`- 범위: ${date} ~ ${date}`));
  // 창에서 "전체"로 넓히면 범위 줄이 사라진다.
  await dialog.getByRole('radio', { name: '전체' }).check();
  await expect(text).not.toHaveValue(/- 범위:/);
  await dialog.getByRole('button', { name: '닫기', exact: true }).click();
  // 여행 메뉴의 "AI로 수정하기"는 전체로 열린다.
  await openTripMenu(page);
  await page.getByRole('button', { name: 'AI로 수정하기', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('radio', { name: '전체' })).toBeChecked();
});

test('A: 과거 계획 버전을 보는 중에는 "AI에게 요청"이 꺼져 있다', async ({ page }) => {
  await page.goto(space('e3-a-old'));
  await createTrip(page);
  await page.getByRole('button', { name: '활동 추가', exact: true }).click();
  await page.getByLabel('활동 제목').fill('가상 산책');
  await page.getByRole('button', { name: '계획 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const versions = await planVersionSelect(page);
  const values = await versions
    .locator('option')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value).filter((value) => value !== ''));
  expect(values.length).toBeGreaterThan(0);
  await versions.selectOption(values[values.length - 1]);
  await page.getByRole('button', { name: '오늘', exact: true }).click();
  await expect(page.locator('.day-toolbar').getByRole('button', { name: 'AI에게 요청', exact: true })).toBeDisabled();
});

test('B: 요청 종류를 바꾸면 [요청] 줄이 바뀌고, 사용자가 고친 글도 반영된다', async ({ page }) => {
  await page.goto(space('e3-b'));
  await createTrip(page);
  await openTripMenu(page);
  await page.getByRole('button', { name: 'AI로 수정하기', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('export-counts')).toBeVisible();
  const text = dialog.getByLabel('나가는 글');
  await expect(text).toHaveValue(/\[요청\] \(여기에 고칠 내용을 적으세요\)/);
  await dialog.getByLabel('요청 종류').selectOption({ label: '빈 칸 채우기' });
  await expect(text).toHaveValue(/\[요청\] 일정의 시간·제목·순서는 바꾸지 말고, 비어 있는 메모·링크 칸만 채워 줘\./);
  await expect(text).toHaveValue(/ID가 있는 장소 줄은 고치지 말아 줘\./);
  if (CAPTURE_DIR) {
    await page.screenshot({ path: `${CAPTURE_DIR}/request-kind-${test.info().project.name}.png` });
  }
  await dialog.getByLabel('요청 내용').fill('메모만 채워 줘');
  await expect(text).toHaveValue(/\[요청\] 메모만 채워 줘/);
  await dialog.getByLabel('요청 종류').selectOption({ label: '자유 요청' });
  await expect(text).toHaveValue(/\[요청\] \(여기에 고칠 내용을 적으세요\)/);
  await expect(dialog.getByLabel('요청 내용')).toHaveValue('');
});

test('C: 프리셋은 관심사·속도(·방문)만 바꾸고 여행지·날짜는 그대로 둔다', async ({ page }) => {
  await page.goto(space('e3-c'));
  await openBrief(page);
  const dialog = page.getByRole('dialog');
  const destination = dialog.getByLabel('여행지', { exact: false });
  await destination.fill('가상 도시');
  await dialog.getByLabel('시작 날짜').fill('2032-06-01');
  await dialog.getByLabel('종료 날짜').fill('2032-06-03');
  await dialog.getByLabel('예산').fill('가상 예산');
  const presets = dialog.getByRole('group', { name: '한 번에 채우기' });
  await presets.getByRole('button', { name: '첫 방문 핵심 관광', exact: true }).click();
  await expect(dialog.getByTestId('fill-note')).toContainText('첫 방문 핵심 관광');
  await expect(destination).toHaveValue('가상 도시');
  await expect(dialog.getByLabel('시작 날짜')).toHaveValue('2032-06-01');
  await expect(dialog.getByLabel('종료 날짜')).toHaveValue('2032-06-03');
  await expect(dialog.getByLabel('예산')).toHaveValue('가상 예산');
  const interests = dialog.getByRole('group', { name: '중요한 것' });
  const pace = dialog.getByRole('group', { name: '속도' });
  await expect(chip(interests, '관광')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip(interests, '문화예술')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip(interests, '미식')).toHaveAttribute('aria-pressed', 'false');
  await expect(chip(pace, '보통')).toHaveAttribute('aria-pressed', 'true');
  // 다른 프리셋은 앞의 관심사를 덮는다.
  await presets.getByRole('button', { name: '여유로운 휴식', exact: true }).click();
  await expect(chip(interests, '휴식')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip(interests, '관광')).toHaveAttribute('aria-pressed', 'false');
  await expect(chip(pace, '여유')).toHaveAttribute('aria-pressed', 'true');
  await expect(destination).toHaveValue('가상 도시');
  if (CAPTURE_DIR) {
    await page.screenshot({ path: `${CAPTURE_DIR}/presets-${test.info().project.name}.png` });
  }
});

test('D: 요청서를 복사하면 지난번 답이 남고, 초안을 지운 뒤 불러오면 여덟 칸만 채워진다', async ({ page }) => {
  await page.goto(space('e3-d'));
  await openBrief(page);
  const dialog = page.getByRole('dialog');
  const load = (scope: Locator) => scope.getByRole('button', { name: '지난번 답 불러오기', exact: true });
  // 남은 것이 없으면 단추가 보이지 않는다.
  await expect(load(dialog)).toHaveCount(0);
  await dialog.getByLabel('여행지', { exact: false }).fill('가상 도시');
  await dialog.getByLabel('시작 날짜').fill('2032-06-01');
  await dialog.getByLabel('예산').fill('가상 50만원');
  await chip(dialog.getByRole('group', { name: '중요한 것' }), '미식').click();
  await chip(dialog.getByRole('group', { name: '속도' }), '알차게').click();
  await dialog.getByText('상세 설정').click();
  await chip(dialog.getByRole('group', { name: '동행' }), '부부').click();
  await dialog.getByLabel('인원').fill('2');
  await chip(dialog.getByRole('group', { name: '방문 경험' }), '재방문').click();
  await chip(dialog.getByRole('group', { name: '이동' }), '렌터카').click();
  await chip(dialog.getByRole('group', { name: '숙소 유형' }), '호텔').click();
  await chip(dialog.getByRole('group', { name: '숙소에서 중요한 것' }), '교통').click();
  await dialog.getByLabel('꼭 고려할 것', { exact: false }).fill('가상 메모');
  await dialog.getByRole('button', { name: '요청서 복사', exact: true }).click();
  await expect(load(dialog)).toBeVisible();
  await dialog.getByRole('button', { name: '준비 초안 지우기', exact: true }).click();
  await expect(dialog.getByText('준비 초안을 지웠습니다.')).toBeVisible();
  await expect(dialog.getByLabel('여행지', { exact: false })).toHaveValue('');
  // 준비 초안을 지워도 지난번 답은 남는다. 닫았다 다시 열어도 같다.
  await dialog.getByRole('button', { name: '닫기', exact: true }).click();
  await openBrief(page);
  const reopened = page.getByRole('dialog');
  if (CAPTURE_DIR) {
    await page.screenshot({ path: `${CAPTURE_DIR}/last-answers-${test.info().project.name}.png` });
  }
  await load(reopened).click();
  await expect(reopened.getByTestId('fill-note')).toContainText('지난번 답을 불러왔습니다(여행지·날짜는 그대로)');
  await expect(reopened.getByLabel('여행지', { exact: false })).toHaveValue('');
  await expect(reopened.getByLabel('시작 날짜')).toHaveValue('');
  await expect(reopened.getByLabel('예산')).toHaveValue('가상 50만원');
  await expect(chip(reopened.getByRole('group', { name: '중요한 것' }), '미식')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(chip(reopened.getByRole('group', { name: '속도' }), '알차게')).toHaveAttribute('aria-pressed', 'true');
  await reopened.getByText('상세 설정').click();
  await expect(chip(reopened.getByRole('group', { name: '동행' }), '부부')).toHaveAttribute('aria-pressed', 'true');
  await expect(reopened.getByLabel('인원')).toHaveValue('2');
  await expect(chip(reopened.getByRole('group', { name: '이동' }), '렌터카')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip(reopened.getByRole('group', { name: '숙소 유형' }), '호텔')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(chip(reopened.getByRole('group', { name: '숙소에서 중요한 것' }), '교통')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // 방문 경험·메모는 불러오지 않는다.
  await expect(chip(reopened.getByRole('group', { name: '방문 경험' }), '재방문')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(reopened.getByLabel('꼭 고려할 것', { exact: false })).toHaveValue('');
  // 지난번 답 지우기는 단추를 없앤다.
  await reopened.getByRole('button', { name: '지난번 답 지우기', exact: true }).click();
  await expect(load(reopened)).toHaveCount(0);
});
