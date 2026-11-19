import { test, expect, type Page } from '@playwright/test';
import { openTripMenu } from './helpers/nav';

/** T-E2 E2-B: 장소 단계(새 여행·수정)와 메모의 `[장소: 이름]` 정리. 가상 자료만 쓴다. */
const NAME = '장소 시험 여행';
const PLAN = [
  `# 여행: ${NAME}`,
  '- 양식: travel-app-plan/1',
  '- 기간: 2027-03-01 ~ 2027-03-02',
  '- 시간대: Asia/Tokyo',
  '',
  '## 일정',
  '### 2027-03-01 첫날',
  '| ID | 시간 | 제목 | 종류 | 장소 | 메모 | 예약 | 링크 |',
  '|---|---|---|---|---|---|---|---|',
  '|  | 09:00 | 공항 도착 | 이동 | 가상 공항 |  |  |  |',
  '|  | 12:00 | 점심 | 식사 | 가상 라멘집 | 줄 서기 |  |  |',
  '|  | 15:00 | 산책 | 관광 | 가상 공원 |  |  |  |',
  '',
  '### 2027-03-02 둘째날',
  '| ID | 시간 | 제목 | 종류 | 장소 | 메모 | 예약 | 링크 |',
  '|---|---|---|---|---|---|---|---|',
  '|  | 10:00 | 다시 공원 | 관광 | 가상 공원 |  |  |  |',
  '',
  '## 장소',
  '| ID | 이름 | 지역 | 설명 | 영업시간 | 링크 |',
  '|---|---|---|---|---|---|',
  '|  | 가상 라멘집 | 가상 구역 | 작은 가게 | 11:00-20:00 | https://example.com/ramen |',
  '',
].join('\n');

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

async function pastePlan(page: Page, text: string) {
  await openTripMenu(page);
  await page.getByRole('button', { name: 'AI 결과 붙여넣기', exact: true }).click();
  await page.getByLabel('붙여 넣은 글').fill(text);
  await page.getByRole('button', { name: '미리보기', exact: true }).click();
}

async function exportedText(page: Page) {
  await openTripMenu(page);
  await page.getByRole('button', { name: 'AI로 수정하기', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(page.getByTestId('export-counts')).toBeVisible();
  const full = await dialog.getByLabel('나가는 글').inputValue();
  await dialog.getByRole('button', { name: '닫기', exact: true }).click();
  const lines = full.split('\n');
  return lines.slice(lines.findIndex((line) => line.startsWith('# '))).join('\n');
}

test('새 여행: 여행 저장 → 장소 단계 승인 → 연결 승인 → 내보내면 장소 표가 있고 그대로 붙여넣으면 변경이 없다', async ({
  page,
}) => {
  await page.goto('/?workspace=content');
  await pastePlan(page, PLAN);
  await page.getByRole('button', { name: '새 여행으로 저장', exact: true }).click();
  await expect(page.getByTestId('new-trip-created')).toContainText('메모');
  const stage = page.getByRole('region', { name: '장소 단계' });
  await expect(stage).toContainText('후보 3개');
  await expect(stage).toContainText('종류 식사');
  await expect(stage).toContainText('영업시간 11:00-20:00');
  await expect(stage.getByLabel('가상 공항 처리')).toHaveValue('create');
  await stage.getByLabel('가상 공원 처리').selectOption('skip');
  await page.getByRole('button', { name: /^장소 2개 만들기/ }).click();
  const link = page.getByRole('region', { name: '장소 연결' });
  await expect(link).toContainText('가상 라멘집');
  await page.getByRole('button', { name: /^활동 \d+개에 연결/ }).click();
  await expect(page.getByRole('heading', { name: NAME, exact: true, level: 1 })).toBeVisible();
  const text = await exportedText(page);
  expect(text).toContain('## 장소');
  expect(text).toMatch(/\| 가상 라멘집 \| 가상 구역 \| 작은 가게 \| 11:00-20:00 \| https:\/\/example.com\/ramen \|/);
  expect(text).not.toContain('[영업시간(미확인)');
  await pastePlan(page, text);
  await expect(page.getByTestId('update-counts')).toContainText('추가 0 · 수정 0 · 삭제 0');
  await expect(page.getByRole('region', { name: '장소 단계' })).toHaveCount(0);
});

test('새 여행: 장소 없이 닫으면 이름이 메모에 남고, 메모 정리 화면에서 나중에 만들 수 있다', async ({ page }) => {
  await page.goto('/?workspace=content');
  await pastePlan(page, PLAN);
  await page.getByRole('button', { name: '새 여행으로 저장', exact: true }).click();
  await page.getByRole('button', { name: '장소 없이 닫기', exact: true }).click();
  await expect(page.getByRole('heading', { name: NAME, exact: true, level: 1 })).toBeVisible();
  await expect(page.getByText('[장소: 가상 공원]').first()).toBeVisible();
  await openTripMenu(page);
  await page.getByRole('button', { name: '메모의 장소 표시 정리', exact: true }).click();
  const stage = page.getByRole('region', { name: '장소 단계' });
  await expect(stage).toContainText('후보 3개');
  await stage.getByLabel('가상 공항 처리').selectOption('skip');
  await page.getByRole('button', { name: /^장소 2개 만들기/ }).click();
  await expect(page.getByRole('region', { name: '장소 연결' })).toContainText('가상 공원');
  await page.getByRole('button', { name: /^활동 3개에 연결/ }).click();
  await expect(page.getByText('장소를 정리했습니다')).toBeVisible();
  await expect(page.getByText('[장소: 가상 공원]')).toHaveCount(0);
  await expect(page.getByText('[장소: 가상 공항]').first()).toBeVisible();
});

test('수정 글: 장소 칸에 새 이름 → 장소 단계 승인 → 미리보기에서 연결로 보이고 적용하면 장소에 연결된다', async ({
  page,
}) => {
  await page.goto('/?workspace=content');
  await pastePlan(page, PLAN.replace(/\n## 장소[\s\S]*$/, '\n'));
  await page.getByRole('button', { name: '새 여행으로 저장', exact: true }).click();
  await expect(page.getByTestId('new-trip-created')).toBeVisible();
  await page.getByRole('button', { name: '장소 없이 닫기', exact: true }).click();
  const text = await exportedText(page);
  const edited = text.replace(/^(\| [0-9a-f-]{36} \| 15:00 \| 산책 \| 관광 \| )가상 공원/m, '$1가상 호수');
  expect(edited).not.toBe(text);
  await pastePlan(page, edited);
  const stage = page.getByRole('region', { name: '장소 단계' });
  await expect(stage).toContainText('후보 1개');
  await expect(page.getByRole('region', { name: '수정 미리보기' })).toContainText('수정');
  await page.getByRole('button', { name: /^장소 1개 만들기/ }).click();
  await expect(page.getByTestId('place-stage-done')).toContainText('만든 장소 1개');
  await expect(page.getByRole('region', { name: '수정 미리보기' })).toContainText('"가상 호수"에 연결합니다');
  await page.getByRole('button', { name: /^고른 \d+건 적용/ }).click();
  await expect(page.getByText('계획을 고쳤습니다')).toBeVisible();
  const after = await exportedText(page);
  expect(after).toMatch(/\| 가상 호수 \|/);
});
