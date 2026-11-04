import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { buildPackage } from '../../src/transfer/package';
import { pilotTrip, fixtureAssets } from '../fixtures/pilot';
import { digestBytes } from '../../src/contracts/v2';
import { openTripMenu } from './helpers/nav';

/**
 * C-13〔U4〕 화면 수정 확인. 가상 여행만 쓴다. (R1) 날짜 머리 고정 위치 (R3) 회고 `계획 설명` 글자 단추
 * (R4) 기록 행 `⋯` 펼침 줄바꿈 (R5) 가이드 장소 썸네일. (R2) 다른 날로 정정된 기록은 삿포로 v2 시험과 단위 시험에서 본다.
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

/** `UI_U4_SHOTS=1`일 때만 뷰포트 스크린샷(전체 캡처 아님)을 증거 폴더에 남긴다. */
async function shot(page: Page, name: string) {
  if (process.env.UI_U4_SHOTS !== '1') {
    return;
  }
  const directory = resolve('docs/design/ui-u4');
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: resolve(directory, `${name}-${test.info().project.name}.png`), fullPage: false });
}
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
async function recordOn(page: Page, title: string, date: string, clock: string) {
  await page.getByRole('button', { name: '예정 외 활동 기록', exact: true }).click();
  await page.getByLabel('활동 이름').fill(title);
  await page.getByLabel('날짜', { exact: true }).fill(date);
  await page.getByLabel('시각 (선택)', { exact: true }).fill(clock);
  await page.getByRole('button', { name: '실제 기록 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}

test('R1 · R4 기록 목록: 날짜 머리는 상단 바 바로 아래에 붙고, ⋯를 펼쳐도 정정 글자가 줄바꿈되지 않는다', async ({
  page,
}) => {
  await page.goto(space('u4-records'));
  await createTrip(page, '가상 기록 여행');
  await nav(page).getByRole('button', { name: '기록', exact: true }).click();
  for (let index = 0; index < 8; index += 1) {
    await recordOn(page, `가상 기록 ${index + 1}`, '2032-06-02', `${String(8 + index).padStart(2, '0')}:00`);
  }
  await recordOn(page, '다음 날 기록', '2032-06-03', '09:00');

  // R4: 펼친 ⋯ 옆에서도 `정정`은 한 줄이다.
  const first = page.locator('article.record-row').first();
  const correct = first.getByRole('button', { name: '정정', exact: true });
  const heightBefore = (await correct.boundingBox())!.height;
  await first.getByLabel('기록 더 보기').click();
  await expect(first.getByRole('button', { name: '기록 당시 내용', exact: true })).toBeVisible();
  expect((await correct.boundingBox())!.height).toBeLessThanOrEqual(heightBefore + 1);
  await shot(page, 'r4-more-open');

  // R1: 스크롤한 상태에서 날짜 머리의 윗선이 상단 바의 아랫선과 맞닿는다(가려지지도 떠 있지도 않다).
  const topbar = page.locator('.journey-topbar');
  const heading = page.locator('.record-day > h3').first();
  await page.evaluate(() => window.scrollTo(0, 400));
  await expect.poll(async () => (await page.evaluate(() => window.scrollY)) > 100).toBe(true);
  const topbarBottom = await topbar.evaluate((el) => el.getBoundingClientRect().bottom);
  const headingTop = await heading.evaluate((el) => el.getBoundingClientRect().top);
  expect(Math.abs(headingTop - topbarBottom)).toBeLessThanOrEqual(1);
  await shot(page, 'r1-sticky-day');
});

test('R3 회고: 설명은 `계획 설명` 글자 단추로 펼쳐지고 접근성 이름이 같다', async ({ page }) => {
  await page.goto(space('u4-retro'));
  await createTrip(page, '가상 회고 여행');
  await nav(page).getByRole('button', { name: '기록', exact: true }).click();
  await page.getByRole('button', { name: '날짜별 회고 보기', exact: true }).click();
  const retro = page.getByRole('region', { name: '날짜별 회고' });
  const help = retro.getByText('계획 설명', { exact: true });
  await expect(help).toBeVisible();
  await expect(retro.getByText('ⓘ')).toHaveCount(0);
  await expect(retro.getByText('읽기 전용입니다.', { exact: false })).toBeHidden();
  await help.click();
  await expect(retro.getByText('읽기 전용입니다.', { exact: false })).toBeVisible();
  await shot(page, 'r3-retro-help');
});

test('R5 가이드: 사진이 있는 장소 행에는 작은 썸네일이 있다(사진 없는 행은 삿포로 v2 시험에서 본다)', async ({
  page,
}) => {
  await page.goto(space('u4-thumb'));
  await expect(page.getByRole('heading', { name: '어느 여행을 열까요?' })).toBeVisible();
  const dataset = await pilotTrip(true);
  const places = dataset.contents.filter((content) => content.kind === 'place');
  const withPhoto = places[0];
  if (withPhoto?.kind !== 'place') {
    throw new Error('표본에 장소가 없습니다.');
  }
  withPhoto.payload.assetRefs = [{ assetId: 'asset-image', role: 'hero', caption: '가상 장소 사진' }];
  const bytes = new Map<string, Uint8Array>();
  for (const value of Object.values(fixtureAssets)) {
    bytes.set(await digestBytes(value), value);
  }
  const packaged = await buildPackage(dataset, bytes, {
    sourceRepository: 'fiction/review',
    sourceCommit: 'synthetic',
    lineageId: 'fiction-thumb',
    adapterVersion: '1',
    normalizationVersion: '1',
  });
  await openTripMenu(page);
  await page.getByLabel('원천 패키지 가져오기').setInputFiles({
    name: 'fiction-thumb.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(await packaged.blob.arrayBuffer()),
  });
  await page.getByRole('button', { name: '여행에 추가', exact: true }).click();
  await nav(page).getByRole('button', { name: '가이드', exact: true }).click();
  const photoRow = page.locator('li.guide-place-row', {
    has: page.getByRole('button', { name: withPhoto.payload.name }),
  });
  const thumbnail = photoRow.locator('img.guide-place-thumb');
  await expect(thumbnail).toBeVisible();
  await expect(thumbnail).toHaveAttribute('alt', '가상 장소 사진');
  const box = (await thumbnail.boundingBox())!;
  expect(box.width).toBe(test.info().project.name === 'mobile' ? 48 : 64);
  expect(box.height).toBe(box.width);
  await shot(page, 'r5-thumbnail');
});
