import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { openMore, openTripMenu } from './helpers/nav';

/**
 * T-E2 A2·A4: "AI로 수정하기"로 내보내고, 글을 고쳐 "AI 결과 붙여넣기"로 비교·적용한다.
 * 가상 고정 자료만 쓴다. 저장 실패 주입은 E2E에서 만들 수 없어 단위 시험(tests/plan-update-apply.test.ts)에서 확인한다.
 */
const T1 = readFileSync('tests/fixtures/plan-format/chatgpt-t1-run2.md', 'utf8');
const OTHER = readFileSync('tests/fixtures/plan-format/claude-t1-run2.md', 'utf8');
const T1_NAME = '후쿠오카 봄 여행 3박 4일';
const ROW = /^\| [0-9a-f]{8}-[0-9a-f-]{27} \|/;

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

async function importTrip(page: Page, text: string, name: string) {
  await openTripMenu(page);
  await page.getByRole('button', { name: 'AI 결과 붙여넣기', exact: true }).click();
  await page.getByLabel('붙여 넣은 글').fill(text);
  await page.getByRole('button', { name: '미리보기', exact: true }).click();
  const save = page.getByRole('button', { name: '새 여행으로 저장', exact: true });
  const duplicate = page.getByLabel('같은 이름의 여행이 있습니다', { exact: false });
  if (await duplicate.isVisible()) {
    await duplicate.check();
  }
  await save.click();
  await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible();
}

/** "AI로 수정하기"의 나가는 글에서 양식 글만 가져온다. 대화상자는 닫는다. */
async function exportedText(page: Page) {
  await openTripMenu(page);
  await page.getByRole('button', { name: 'AI로 수정하기', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('export-counts')).toBeVisible();
  const full = await dialog.getByLabel('나가는 글').inputValue();
  await dialog.getByRole('button', { name: '닫기', exact: true }).click();
  const lines = full.split('\n');
  const start = lines.findIndex((line) => line.startsWith('```') || line.startsWith('# '));
  return lines.slice(start).join('\n');
}

function rowsOf(text: string) {
  return text.split('\n').filter((line) => ROW.test(line));
}

function retitle(line: string, title: string) {
  const cells = line.split(' | ');
  cells[2] = title;
  return cells.join(' | ');
}

async function pasteUpdate(page: Page, text: string) {
  await openTripMenu(page);
  await page.getByRole('button', { name: 'AI 결과 붙여넣기', exact: true }).click();
  await page.getByLabel('붙여 넣은 글').fill(text);
  await page.getByRole('button', { name: '미리보기', exact: true }).click();
}

test('내보내기 글에 요청 틀·글자 수가 보이고 서버 호출이 없다', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4173')) {
      requests.push(request.url());
    }
  });
  await page.goto('/?workspace=content');
  await importTrip(page, T1, T1_NAME);
  await openTripMenu(page);
  await page.getByRole('button', { name: 'AI로 수정하기', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(page.getByTestId('export-counts')).toContainText(/[\d,]+자/);
  await expect(dialog.getByLabel('나가는 글')).toHaveValue(/\[요청\]/);
  await expect(dialog.getByLabel('나가는 글')).toHaveValue(/기준revision/);
  expect(requests).toEqual([]);
});

test('내보내기 → 글 고치기 → 붙여넣기 → 개수 → 적용 → 일정 화면과 이전 버전, 같은 글은 다시 적용할 수 없다', async ({
  page,
}) => {
  await page.goto('/?workspace=content');
  await importTrip(page, T1, T1_NAME);
  const text = await exportedText(page);
  const rows = rowsOf(text);
  expect(rows.length).toBeGreaterThan(3);
  const edited = text
    .split('\n')
    .flatMap((line) => {
      if (line === rows[0]) {
        return [retitle(line, '고친 첫 활동'), '|  | 22:00 | 새로 넣은 활동 | 기타 |  |  |  |  |'];
      }
      return [line];
    })
    .join('\n');
  await pasteUpdate(page, edited);
  await expect(page.getByTestId('update-counts')).toContainText('추가 1 · 수정 1 · 삭제 0');
  await expect(page.getByText('고친 첫 활동', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: /^고른 2건 적용/ }).click();
  await expect(page.getByText('계획을 고쳤습니다. 수정 1·추가 1·삭제 0')).toBeVisible();

  await page.getByRole('button', { name: '오늘', exact: true }).first().click();
  await expect(page.locator('.day-timeline h3').first()).toHaveText('고친 첫 활동');
  await openMore(page, '계획 버전');
  const versions = page.getByLabel('계획 버전');
  await expect(versions.locator('option')).toHaveCount(3);
  await expect(versions.locator('option', { hasText: 'AI 결과 붙여넣기: 수정 1·추가 1·삭제 0' })).toHaveCount(1);
  await versions.selectOption({ index: 2 });
  await page.getByRole('button', { name: '오늘', exact: true }).first().click();
  await expect(page.locator('.day-timeline h3').first()).toHaveText('인천공항 출국 및 후쿠오카행 항공 이동');
  await openMore(page, '계획 버전');
  await versions.selectOption({ index: 0 });
  await page.getByRole('button', { name: '오늘', exact: true }).first().click();

  // 복사한 뒤 다른 변경이 저장됐으므로 같은 글은 적용할 수 없다.
  await pasteUpdate(page, edited);
  await expect(page.getByText("다시 'AI로 수정하기'로 복사해 작업하세요")).toBeVisible();
  await expect(page.getByRole('button', { name: /적용/ })).toHaveCount(0);
});

test('일부만 골라 적용하고, 삭제는 확인해야 적용할 수 있다', async ({ page }) => {
  await page.goto('/?workspace=content');
  await importTrip(page, T1, T1_NAME);
  const text = await exportedText(page);
  const rows = rowsOf(text);
  const edited = text
    .split('\n')
    .flatMap((line) => {
      if (line === rows[1]) {
        return [retitle(line, '둘째 고침')];
      }
      if (line === rows[2]) {
        return [retitle(line, '셋째 고침')];
      }
      return [line];
    })
    .join('\n');
  await pasteUpdate(page, edited);
  await expect(page.getByTestId('update-counts')).toContainText('수정 2');
  const second = page.getByRole('region', { name: '수정', exact: true }).getByRole('checkbox');
  await expect(second).toHaveCount(2);
  await second.nth(1).uncheck();
  await page.getByRole('button', { name: /^고른 1건 적용/ }).click();
  await expect(page.getByText('계획을 고쳤습니다. 수정 1·추가 0·삭제 0')).toBeVisible();
});

test('새 활동은 그날 맨 끝이 아니라 시간순 자리에 보인다', async ({ page }) => {
  await page.goto('/?workspace=content');
  await importTrip(page, T1, T1_NAME);
  const text = await exportedText(page);
  const [first, second] = rowsOf(text).map((line) => line.split(' | '));
  const clock = first[1].split('-')[0];
  const edited = text
    .split('\n')
    .flatMap((line) =>
      line === rowsOf(text)[0] ? [line, `|  | ${clock} | 시간순 새 활동 | 기타 |  |  |  |  |`] : [line],
    )
    .join('\n');
  await pasteUpdate(page, edited);
  await expect(page.getByText('그날 마지막에 들어갑니다.').or(page.getByText('앞에 들어갑니다.'))).toBeVisible();
  await expect(page.getByTestId('order-shifted')).toContainText('순서 조정');
  await page.getByRole('button', { name: /^고른 1건 적용/ }).click();
  await expect(page.getByText('계획을 고쳤습니다. 수정 0·추가 1·삭제 0')).toBeVisible();
  await page.getByRole('button', { name: '오늘', exact: true }).first().click();
  const titles = page.locator('.day-timeline h3');
  await expect(titles.nth(0)).toHaveText(first[2]);
  await expect(titles.nth(1)).toHaveText('시간순 새 활동');
  await expect(titles.nth(2)).toHaveText(second[2]);
});

test('삭제는 확인 칸을 체크해야 적용되고, 적용하면 그 활동이 사라진다', async ({ page }) => {
  await page.goto('/?workspace=content');
  await importTrip(page, T1, T1_NAME);
  const text = await exportedText(page);
  const target = rowsOf(text)[1].split(' | ');
  const id = target[0].replace('| ', '');
  const title = target[2];
  const lines = text.split('\n');
  const head = lines.slice(
    0,
    lines.findIndex((line) => line.startsWith('## ')),
  );
  const deletion = [...head, '## 삭제', '| 종류 | ID | 제목 |', '|---|---|---|', `| 활동 | ${id} | ${title} |`].join(
    '\n',
  );
  await pasteUpdate(page, deletion);
  await expect(page.getByTestId('update-counts')).toContainText('삭제 1');
  const apply = page.getByRole('button', { name: /^고른 1건 적용/ });
  await expect(apply).toBeDisabled();
  await page.getByLabel('삭제 1건을 확인했습니다').check();
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(page.getByText('계획을 고쳤습니다. 수정 0·추가 0·삭제 1')).toBeVisible();
});

test('다른 여행의 글이면 그 여행 이름을 알려 주고 적용하지 않는다', async ({ page }) => {
  await page.goto('/?workspace=content');
  await importTrip(page, T1, T1_NAME);
  const text = await exportedText(page);
  await importTrip(page, OTHER, await firstHeading(page, OTHER));
  await pasteUpdate(page, text);
  await expect(page.getByText(T1_NAME, { exact: false }).first()).toBeVisible();
  await expect(page.getByText('열려 있는 여행의 글이 아닙니다', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: /적용/ })).toHaveCount(0);
});

async function firstHeading(_page: Page, text: string) {
  const match = text.match(/^# 여행:\s*(.+)$/m);
  return (match?.[1] ?? '').trim();
}
