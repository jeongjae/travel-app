import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { buildPackage } from '../../src/transfer/package';
import { pilotTrip, fixtureAssets } from '../fixtures/pilot';
import { digestBytes } from '../../src/contracts/v2';
import { openMore, openTripMenu } from './helpers/nav';

/**
 * C-14 파리 패키지 화면 표시 정리. 가상 표본만 쓴다. 저장값은 그대로이고 화면 표시만 바뀐다.
 * (P1) 긴 여행 이름 (P2) 이전 원천 상태 접기 (P3) 같은 제목 가이드 구분 (P7) 첫 화면 가져오기 입구.
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

async function shot(page: Page, name: string) {
  if (process.env.UI_C14_SHOTS !== '1') {
    return;
  }
  const directory = resolve('docs/design/ui-c14');
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: resolve(directory, `${name}-${test.info().project.name}.png`), fullPage: false });
}
const space = (name: string) => `/?workspace=content&review=${name}-${test.info().project.name}`;
const nav = (page: Page) => page.getByRole('navigation', { name: '주요 메뉴' });

const LONG_NAME = `가상 대표 구간 Day ${Array.from({ length: 43 }, (_, index) => index + 1).join('·')}`;

/** 긴 이름과 같은 제목의 가이드 둘이 든 가상 패키지를 만든다. 저장값(이름·제목)은 원문 그대로 둔다. */
async function syntheticPackage() {
  const dataset = await pilotTrip(true);
  dataset.header.name = LONG_NAME;
  const base = dataset.contents.find((content) => content.kind === 'guide');
  if (base?.kind !== 'guide') {
    throw new Error('표본에 가이드가 없습니다.');
  }
  for (const [entityId, region] of [
    ['source-document-a', 'region-1'],
    ['source-document-b', 'region-2'],
  ] as const) {
    const copy = structuredClone(base);
    copy.entityId = entityId;
    copy.payload.documentKind = 'preparation';
    copy.payload.title = 'Commercial Guide Module';
    copy.payload.ownerRef = { tripId: base.tripId, targetKind: 'trip', entityId: base.tripId };
    copy.sourceRefs = [
      {
        sourceKind: 'markdown',
        sourceKey: `${region}.md`,
        locator: `${region}.md`,
        sourcePath: `source/CURRENT/20_Regional_Chapters/0${region.slice(-1)}_Region_${region.slice(-1)}_v1.0.md`,
      },
    ];
    dataset.contents.push(copy);
    dataset.heads.push({
      tripId: base.tripId,
      targetKind: 'guide',
      entityId,
      revisionId: copy.revisionId,
      status: 'active',
    });
  }
  const bytes = new Map<string, Uint8Array>();
  for (const value of Object.values(fixtureAssets)) {
    bytes.set(await digestBytes(value), value);
  }
  return buildPackage(dataset, bytes, {
    sourceRepository: 'fiction/review',
    sourceCommit: 'synthetic',
    lineageId: 'fiction-c14',
    adapterVersion: '1',
    normalizationVersion: '1',
  });
}

test('P7 첫 화면: 가져오기 단추 하나와 백업 안내 한 줄', async ({ page }) => {
  await page.goto(space('c14-start'));
  const start = page.locator('section.empty-start');
  await expect(start.getByRole('heading', { name: '어느 여행을 열까요?' })).toBeVisible();
  await expect(start.getByText('원천 패키지 가져오기 (pilot.zip)')).toBeVisible();
  await expect(start.getByText('전체 백업에서 되살리기:', { exact: false })).toBeVisible();
  await expect(start.getByRole('button', { name: '저장소·백업', exact: true })).toBeVisible();
  // 여행이 없으면 페이지 전체에 파일 입력이 하나뿐이다(위쪽 패널의 입구는 숨김).
  await expect(page.locator('input[type="file"]')).toHaveCount(1);
  await expect(page.locator('.journey-library input[type="file"]')).toHaveCount(0);
  await shot(page, 'p7-start');
});

test('P1 · P2 · P3 긴 이름은 (N일)로, 원천 상태는 접기 하나로, 같은 제목 가이드는 구분되어 보인다', async ({
  page,
}) => {
  await page.goto(space('c14-package'));
  await expect(page.getByRole('heading', { name: '어느 여행을 열까요?' })).toBeVisible();
  const packaged = await syntheticPackage();
  // 첫 화면 본문의 가져오기 입구로 가져온다.
  await page
    .locator('section.empty-start')
    .getByLabel('원천 패키지 가져오기 (pilot.zip)')
    .setInputFiles({
      name: 'fiction-c14.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from(await packaged.blob.arrayBuffer()),
    });
  await page.getByRole('button', { name: '여행에 추가', exact: true }).click();

  // P1: 머리 단추는 줄여 보이고 전체 이름은 여행 메뉴에 남는다. 영문 `Day 1·2·…` 나열은 보이지 않는다.
  const switchButton = page.locator('.trip-switch');
  await expect(switchButton).toContainText('가상 대표 구간 (43일)');
  expect(((await switchButton.textContent()) ?? '').length).toBeLessThan(40);
  await expect(page).toHaveTitle(/가상 대표 구간 \(43일\) · travel-app/);
  await openTripMenu(page);
  await expect(page.locator('.trip-full-name')).toHaveText(LONG_NAME);
  // 여행이 있으면 입구는 여행 메뉴의 하나뿐이다(첫 화면 본문에는 없다).
  await expect(page.locator('input[type="file"]')).toHaveCount(1);
  await expect(page.locator('.journey-library input[type="file"]')).toHaveCount(1);
  await shot(page, 'p1-trip-name');
  await switchButton.click();

  // P2: 기록 탭의 이전 원천 상태는 접기 하나이고 영문 상태값이 보이지 않는다.
  await nav(page).getByRole('button', { name: '기록', exact: true }).click();
  const fold = page.locator('details.legacy-states');
  await expect(fold).toHaveCount(1);
  await expect(fold.locator('summary')).toContainText('이전 원천의 방문 체크 1건 (방문 1 · 미방문 0)');
  await fold.locator('summary').click();
  await expect(fold.getByText('방문함', { exact: false })).toBeVisible();
  await expect(page.getByText('visited')).toHaveCount(0);
  await expect(page.getByText('원천 방문 체크 상태입니다')).toHaveCount(0);
  await shot(page, 'p2-legacy-states');

  // P3: 준비·회화의 단추 이름이 서로 겹치지 않는다.
  await openMore(page, '준비·회화');
  const guideButtons = page.getByRole('navigation', { name: '여행 자료' }).getByRole('button');
  await expect(guideButtons).toHaveCount(2);
  const names = await guideButtons.allTextContents();
  expect(new Set(names).size).toBe(names.length);
  expect(names.filter((name) => name.includes('Commercial Guide Module'))).toHaveLength(2);
  expect(names.every((name) => !name.includes('Commercial Guide Module') || name.includes(' · '))).toBe(true);
  await shot(page, 'p3-guide-buttons');
});

/** 실제 원천 패키지 대조(읽기 전용). `C14_REAL_PACKAGE`가 있을 때만 돌고 스크린샷은 커밋하지 않는 local-data에 둔다. */
test('실제 패키지 대조: 머리·원천 상태·가이드 단추 수치', async ({ page }) => {
  test.setTimeout(420_000);
  test.skip(!process.env.C14_REAL_PACKAGE, 'C14_REAL_PACKAGE 없음');
  await page.goto(space('c14-real'));
  await expect(page.getByRole('heading', { name: '어느 여행을 열까요?' })).toBeVisible();
  await page
    .locator('section.empty-start')
    .getByLabel('원천 패키지 가져오기 (pilot.zip)')
    .setInputFiles(process.env.C14_REAL_PACKAGE!);
  const add = page.getByRole('button', { name: '여행에 추가', exact: true });
  await expect(add).toBeEnabled({ timeout: 120_000 });
  await add.click();
  const directory = resolve('local-data/c14-real-shots');
  await mkdir(directory, { recursive: true });
  const project = test.info().project.name;
  const take = (name: string) => page.screenshot({ path: resolve(directory, `${name}-${project}.png`) });
  await expect(page.locator('.trip-switch')).toBeVisible({ timeout: 180_000 });
  const headerText = ((await page.locator('.trip-switch').textContent()) ?? '').replace('▾', '').trim();
  await take('p1-header');
  await nav(page).getByRole('button', { name: '기록', exact: true }).click();
  const legacy = await page.locator('details.legacy-states summary').textContent();
  await take('p2-record');
  await openMore(page, '준비·회화');
  const guideButtons = page.getByRole('navigation', { name: '여행 자료' }).getByRole('button');
  await expect(guideButtons.first()).toBeVisible();
  const names = await guideButtons.allTextContents();
  await take('p3-guides');
  console.log(
    `C14-REAL header="${headerText}"(${headerText.length}자) legacy="${legacy}" guideButtons=${names.length} unique=${new Set(names).size}`,
  );
  expect(new Set(names).size).toBe(names.length);
});
