import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { openTripMenu, skipPlaceStage } from './helpers/nav';

/** T-P1 C2~C4: 가이드 붙여넣기 → 카드 고르기 → 요청서 결합 → 초안 복원 → AI 결과 옆 목록. 가상 고정 자료만 쓴다. */
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const GUIDE = readFileSync('tests/fixtures/guide-format/hakodate.md', 'utf8');
const P0_PLAN = readFileSync('docs/p0-results/g3-b-with-selection.md', 'utf8');

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

async function openBrief(page: Page) {
  await page.goto('/?workspace=content');
  await openTripMenu(page);
  await page.getByRole('button', { name: 'AI로 계획 만들기', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

async function pasteGuide(page: Page, text = GUIDE) {
  await page.getByLabel('붙여 넣은 가이드').fill(text);
  await page.getByRole('button', { name: '가이드 읽기', exact: true }).click();
}

const card = (page: Page, name: string) => page.locator('.guide-card').filter({ hasText: name }).first();

async function choose(page: Page, name: string, label: '꼭 포함' | '관심' | '제외') {
  await card(page, name).getByRole('button', { name: label, exact: true }).click();
}

/** 모든 IndexedDB의 모든 저장소 내용을 글로 만든다. 가이드·고르기가 여행 DB를 바꾸지 않는지 비교하는 데 쓴다. */
async function databaseSnapshot(page: Page) {
  return page.evaluate(async () => {
    const dump: Record<string, unknown> = {};
    for (const info of await indexedDB.databases()) {
      if (!info.name) {
        continue;
      }
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(info.name!);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const stores: Record<string, unknown> = {};
      for (const name of Array.from(db.objectStoreNames)) {
        stores[name] = await new Promise((resolve, reject) => {
          const request = db.transaction(name).objectStore(name).getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }
      db.close();
      dump[info.name] = stores;
    }
    return JSON.stringify(dump);
  });
}

test('① 가이드 붙여넣기 → 카드 34개 → 3·1·3 고르기 → 요청서 → 새로고침 뒤에도 유지, DB는 그대로', async ({ page }) => {
  await openBrief(page);
  await page.getByLabel('여행지 (여러 곳은 쉼표로)').fill('하코다테');
  const before = await databaseSnapshot(page);
  await pasteGuide(page);
  await expect(page.getByText('AI가 만든 가이드 · 내용은 확인되지 않았습니다').first()).toBeVisible();
  await expect(page.locator('.guide-card')).toHaveCount(34);
  await expect(page.getByText('기준일 2026-11-16')).toBeVisible();

  await choose(page, '유노카와 온천 입욕', '꼭 포함');
  await choose(page, '하코다테산 전망대', '꼭 포함');
  await choose(page, '하코다테 시오라멘', '꼭 포함');
  await choose(page, '하코다테 아침시장', '관심');
  await choose(page, '구 영국영사관', '제외');
  await choose(page, '하코다테 열대식물원', '제외');
  await choose(page, '오누마 국정공원', '제외');
  await expect(page.getByTestId('guide-total')).toContainText('꼭 포함 3 · 관심 1 · 제외 3');
  await expect(card(page, '구 영국영사관').getByRole('button', { name: '제외', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  const preview = page.getByLabel('요청서 미리보기');
  await expect(preview).toHaveValue(
    /\[꼭 포함\]\n반드시 넣어 줘\. 어렵다면 이유와 대안을 알려 줘\.\n- 볼거리 \/ 하코다테산 전망대 \/ 하코다테산\n- 먹거리 \/ 하코다테 시오라멘/,
  );
  await expect(preview).toHaveValue(/- 체험 \/ 유노카와 온천 입욕 \/ 유노카와 온천/);
  await expect(preview).toHaveValue(/\[관심\]\n동선과 시간이 맞으면 넣어 줘\.\n- 볼거리 \/ 하코다테 아침시장/);
  await expect(preview).toHaveValue(/\[제외\]\n넣지 말아 줘\.\n- 볼거리 \/ 구 영국영사관/);
  await expect(preview).toHaveValue(/\[확인할 것\]/);
  await expect(preview).toHaveValue(/\[꼭 포함\]을 넣기 어렵거나 \[제외\]를 넣어야 한다면/);
  await page.getByRole('button', { name: '요청서 복사', exact: true }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('- 볼거리 / 오누마 국정공원');
  expect(copied).not.toContain('고료카쿠 타워');

  await page.reload();
  await page.getByRole('button', { name: 'AI로 계획 만들기', exact: true }).click();
  await expect(page.locator('.guide-card')).toHaveCount(34);
  await expect(page.getByTestId('guide-total')).toContainText('꼭 포함 3 · 관심 1 · 제외 3');
  await expect(page.getByLabel('여행지 (여러 곳은 쉼표로)')).toHaveValue('하코다테');
  expect(await databaseSnapshot(page)).toBe(before);
  expect(await page.evaluate(() => localStorage.getItem('travel-app.prep-draft.v1'))).toContain('travel-app-guide/1');
});

test('② 종류로 거른 뒤 한 번에 고르기, 같은 이름 알림', async ({ page }) => {
  await openBrief(page);
  await pasteGuide(page);
  await page.getByRole('group', { name: '종류로 거르기' }).getByRole('button', { name: '먹거리', exact: true }).click();
  await expect(page.locator('.guide-card')).toHaveCount(8);
  await page.getByText('한 번에 고르기', { exact: false }).click();
  await expect(page.getByText('8개가 바뀝니다')).toHaveCount(3);
  await page.getByRole('button', { name: '모두 꼭 포함', exact: true }).click();
  await expect(page.getByTestId('guide-total')).toContainText('꼭 포함 8 · 관심 0 · 제외 0');
  await expect(page.getByRole('button', { name: '모두 꼭 포함', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '모두 고르지 않음', exact: true }).click();
  await expect(page.getByTestId('guide-total')).toContainText('꼭 포함 0 · 관심 0 · 제외 0');

  await page.getByRole('group', { name: '종류로 거르기' }).getByRole('button', { name: '전체', exact: true }).click();
  await choose(page, '오누마 국정공원', '제외');
  await expect(card(page, '오누마 국정공원').getByRole('note')).toContainText('겨울 오누마 설경 산책');
  await page.getByLabel('고른 것만 보기').check();
  await expect(page.locator('.guide-card')).toHaveCount(1);
});

test('③ 가이드 바꾸기는 확인 뒤에만, 오류 가이드는 기존 상태를 건드리지 않는다', async ({ page }) => {
  await openBrief(page);
  await pasteGuide(page);
  await choose(page, '하코다테산 전망대', '꼭 포함');
  await page.getByRole('button', { name: '가이드 바꾸기', exact: true }).click();

  await pasteGuide(page, GUIDE.replace('| 볼거리 | 가네모리', '| 숙소 | 가네모리'));
  await expect(page.getByRole('list', { name: '가이드 오류' })).toContainText('종류 "숙소"');
  await expect(page.getByTestId('guide-total')).toContainText('꼭 포함 1 · 관심 0 · 제외 0');

  const other = GUIDE.replace('# 가이드: 일본 하코다테', '# 가이드: 가상 다른 곳');
  await pasteGuide(page, other);
  await expect(page.getByText('고른 것이 모두 지워집니다')).toBeVisible();
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.getByRole('heading', { name: /일본 하코다테 가이드/ })).toBeVisible();
  await expect(page.getByTestId('guide-total')).toContainText('꼭 포함 1 · 관심 0 · 제외 0');

  await page.getByLabel('붙여 넣은 가이드').fill(other);
  await page.getByRole('button', { name: '가이드 읽기', exact: true }).click();
  await page.getByRole('button', { name: '바꾸기', exact: true }).click();
  await expect(page.getByRole('heading', { name: /가상 다른 곳 가이드/ })).toBeVisible();
  await expect(page.getByTestId('guide-total')).toContainText('꼭 포함 0 · 관심 0 · 제외 0');
});

test('④ 가이드 없이도 요청서가 만들어지고, 가이드 요청문은 여행지가 있어야 복사된다', async ({ page }) => {
  await openBrief(page);
  const preview = page.getByLabel('요청서 미리보기');
  await expect(preview).toHaveValue(/\[부탁할 일\]/);
  await expect(preview).not.toHaveValue(/\[꼭 포함\]/);
  const request = page.getByRole('button', { name: '가이드 요청문 복사', exact: true });
  await expect(request).toBeDisabled();
  await expect(page.getByText('여행지를 먼저 적어 주세요')).toBeVisible();
  await page.getByLabel('여행지 (여러 곳은 쉼표로)').fill('삿포로');
  await page.getByLabel('시작 날짜').fill('2027-01-02');
  await page.getByLabel('종료 날짜').fill('2027-01-05');
  await request.click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text.startsWith('삿포로를 2027-01-02~2027-01-05에 여행하려고 한다.')).toBe(true);
  expect(text).toContain('travel-app-guide/1');
  await page.getByRole('button', { name: '가이드 없이 계속', exact: true }).click();
});

test('가이드 오류 화면은 머리 줄·줄 번호를 보여 주고 계획 글은 계획 안내로 거부한다', async ({ page }) => {
  await openBrief(page);
  await pasteGuide(page, GUIDE.replace('# 가이드: 일본 하코다테\n', '').replace('\r', ''));
  await expect(page.getByRole('list', { name: '가이드 오류' })).toContainText('머리 줄');
  await expect(page.getByText('가이드 양식의 코드 블록 하나로 다시 정리해 줘')).toBeVisible();
  await pasteGuide(page, P0_PLAN);
  await expect(page.getByRole('alert').filter({ hasText: '이것은 계획입니다' })).toBeVisible();
});

test('준비 초안 지우기, 안내 문구', async ({ page }) => {
  await openBrief(page);
  await expect(page.getByTestId('draft-notice')).toContainText('이 기기에만 저장됩니다');
  await page.getByLabel('여행지 (여러 곳은 쉼표로)').fill('교토');
  await page.getByRole('button', { name: '준비 초안 지우기', exact: true }).click();
  await expect(page.getByLabel('여행지 (여러 곳은 쉼표로)')).toHaveValue('');
  expect(await page.evaluate(() => localStorage.getItem('travel-app.prep-draft.v1'))).toBeNull();
});

test('깨진 초안은 버리고 알린다', async ({ page }) => {
  await page.goto('/?workspace=content');
  await page.evaluate(() => localStorage.setItem('travel-app.prep-draft.v1', '{깨짐'));
  await openTripMenu(page);
  await page.getByRole('button', { name: 'AI로 계획 만들기', exact: true }).click();
  await expect(page.getByText('저장된 준비 초안의 형식이 달라 버렸습니다.')).toBeVisible();
});

test('⑥ AI 결과 붙여넣기 미리보기 옆에 고른 목록이 보이고, 고른 게 없으면 보이지 않는다', async ({ page }) => {
  await page.goto('/?workspace=content');
  await openTripMenu(page);
  await page.getByRole('button', { name: 'AI 결과 붙여넣기', exact: true }).click();
  await expect(page.getByRole('region', { name: '내가 고른 것' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'AI로 계획 만들기', exact: true }).click();
  await pasteGuide(page);
  await choose(page, '유노카와 온천 입욕', '꼭 포함');
  await choose(page, '구 영국영사관', '제외');
  await choose(page, '하코다테 아침시장', '관심');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'AI 결과 붙여넣기', exact: true }).click();
  const chosen = page.getByRole('region', { name: '내가 고른 것' });
  await expect(chosen).toContainText('내가 고른 것 — 계획에 반영됐는지 확인하세요');
  await expect(chosen).toContainText('꼭 포함 1개');
  await expect(chosen).toContainText('유노카와 온천 입욕');
  await expect(chosen).toContainText('제외 1개');
  await expect(chosen).toContainText('구 영국영사관');
  await expect(chosen).not.toContainText('하코다테 아침시장');
  await page.getByLabel('붙여 넣은 글').fill(P0_PLAN);
  await page.getByRole('button', { name: '미리보기', exact: true }).click();
  await expect(page.getByRole('region', { name: '해석 결과' })).toBeVisible();
  await expect(chosen).toBeVisible();
});

test('⑦ 오프라인에서도 붙여넣기·고르기·요청서가 된다', async ({ page, context }) => {
  await openBrief(page);
  await context.setOffline(true);
  await pasteGuide(page);
  await choose(page, '하코다테산 전망대', '꼭 포함');
  await expect(page.getByLabel('요청서 미리보기')).toHaveValue(/- 볼거리 \/ 하코다테산 전망대/);
  await context.setOffline(false);
});

test('새 여행을 저장해도 초안은 자동으로 지워지지 않고, 지우기를 제안한다', async ({ page }) => {
  const plan = readFileSync('tests/fixtures/plan-format/chatgpt-t1-run2.md', 'utf8');
  await openBrief(page);
  await page.getByLabel('여행지 (여러 곳은 쉼표로)').fill('후쿠오카');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'AI 결과 붙여넣기', exact: true }).click();
  await page.getByLabel('붙여 넣은 글').fill(plan);
  await page.getByRole('button', { name: '미리보기', exact: true }).click();
  await page.getByRole('button', { name: '새 여행으로 저장', exact: true }).click();
  await skipPlaceStage(page);
  await expect(page.getByRole('heading', { level: 1, name: '후쿠오카 봄 여행 3박 4일' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('travel-app.prep-draft.v1'))).not.toBeNull();
  await page.getByRole('button', { name: '준비 초안 지우기', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('travel-app.prep-draft.v1'))).toBeNull();
});

test('R2-1 걸렀을 때 전체 수와 보이는 수가 따로 맞게 나온다', async ({ page }) => {
  await openBrief(page);
  await pasteGuide(page);
  await choose(page, '하코다테산 전망대', '꼭 포함');
  await choose(page, '하코다테 시오라멘', '관심');
  await choose(page, '구 영국영사관', '제외');
  const total = page.getByTestId('guide-total');
  await expect(total).toContainText('고른 항목 — 꼭 포함 1 · 관심 1 · 제외 1 (전체 34개 중)');
  await expect(page.getByTestId('guide-visible')).toHaveCount(0);

  await page.getByRole('group', { name: '종류로 거르기' }).getByRole('button', { name: '먹거리', exact: true }).click();
  await expect(total).toContainText('꼭 포함 1 · 관심 1 · 제외 1 (전체 34개 중)');
  await expect(page.getByTestId('guide-visible')).toContainText('지금 보이는 8개 중 — 꼭 포함 0 · 관심 1 · 제외 0');

  await page.getByRole('group', { name: '종류로 거르기' }).getByRole('button', { name: '전체', exact: true }).click();
  await page.getByLabel('고른 것만 보기').check();
  await expect(page.getByTestId('guide-visible')).toContainText('지금 보이는 3개 중 — 꼭 포함 1 · 관심 1 · 제외 1');
  await expect(total).toContainText('(전체 34개 중)');
});

test('R2-2 카드는 접혀 있고 눌러 펼치며, 모두 펼치기·접기와 고르기가 따로 동작한다', async ({ page }) => {
  await openBrief(page);
  await pasteGuide(page);
  const first = card(page, '하코다테산 전망대');
  const detail = first.locator('.guide-card-detail');
  await expect(detail).toBeHidden();
  await first.getByRole('button', { name: /하코다테산 전망대/, expanded: false }).click();
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('확인 필요');
  await first.getByRole('button', { name: /하코다테산 전망대/, expanded: true }).click();
  await expect(detail).toBeHidden();

  await choose(page, '하코다테산 전망대', '꼭 포함');
  await expect(detail).toBeHidden();
  await expect(page.getByTestId('guide-total')).toContainText('꼭 포함 1');

  await page.getByRole('button', { name: '모두 펼치기', exact: true }).click();
  await expect(page.locator('.guide-card-detail:visible')).toHaveCount(34);
  await page.getByRole('button', { name: '모두 접기', exact: true }).click();
  await expect(page.locator('.guide-card-detail:visible')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '요청서 만들기로', exact: true })).toBeVisible();
});

test('R2-3 날짜 두 칸이 한 줄이고, 같은 묶음의 단추 높이가 같다', async ({ page }) => {
  await openBrief(page);
  const start = await page.getByLabel('시작 날짜').boundingBox();
  const end = await page.getByLabel('종료 날짜').boundingBox();
  expect(start && end).toBeTruthy();
  expect(Math.abs(start!.y - end!.y)).toBeLessThan(2);
  expect(start!.width).toBeLessThanOrEqual(11 * 16 + 2);
  expect(end!.x).toBeGreaterThan(start!.x + start!.width - 1);

  await pasteGuide(page);
  const heights = await page
    .locator('.guide-panel .prep-actions button, .guide-panel .guide-card-choices button')
    .evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().height)));
  expect(heights.length).toBeGreaterThan(3);
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);

  const kinds = page.getByRole('group', { name: '종류로 거르기' });
  await kinds.getByRole('button', { name: '먹거리', exact: true }).click();
  const boxes = await kinds
    .getByRole('button')
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect()).map((box) => [box.top, box.height]));
  expect(new Set(boxes.map(([top]) => Math.round(top))).size).toBe(1);
  expect(new Set(boxes.map(([, height]) => Math.round(height))).size).toBe(1);
});
