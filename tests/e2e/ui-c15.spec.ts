import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { buildPackage } from '../../src/transfer/package';
import { pilotTrip, fixtureAssets } from '../fixtures/pilot';
import { digestBytes } from '../../src/contracts/v2';
import { planDayPhotos } from '../../src/content/day-photos';
import { guideMenu, openMore, selectDayByDate } from './helpers/nav';

/**
 * C-15 파리 여행 읽기 화면 정리. 가상 표본만 쓴다. 저장값은 그대로이고 화면 표시만 바뀐다.
 * (Q1) 메모 대화상자 이름 (Q2) 준비·회화 묶음과 가이드 상세 (Q3) 날짜 사진.
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
  if (process.env.UI_C15_SHOTS !== '1') {
    return;
  }
  const directory = resolve('docs/design/ui-c15');
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: resolve(directory, `${name}-${test.info().project.name}.png`), fullPage: false });
}
const space = (name: string) => `/?workspace=content&review=${name}-${test.info().project.name}`;
const nav = (page: Page) => page.getByRole('navigation', { name: '주요 메뉴' });

const LONG_NAME = `가상 대표 구간 Day ${Array.from({ length: 43 }, (_, index) => index + 1).join('·')}`;
const BODY = '## 첫째 머리\n첫째 본문\n\n### 둘째 머리\n둘째 본문\n\n## 셋째 머리\n셋째 본문';

/** 가상 패키지: 긴 이름, 지역 가이드(머리말·원천 속성), 여행 전체 자료, 사진 있는 날과 없는 날. */
async function syntheticPackage() {
  const dataset = await pilotTrip();
  dataset.header.name = LONG_NAME;
  const base = dataset.contents.find((content) => content.kind === 'guide');
  if (base?.kind !== 'guide') {
    throw new Error('표본에 가이드가 없습니다.');
  }
  const addGuide = (
    entityId: string,
    title: string,
    documentKind: 'region-guide' | 'preparation',
    ownerRef: { targetKind: 'region' | 'trip'; entityId: string },
    sections: { key: string; title: string; bodyMd: string }[],
  ) => {
    const copy = structuredClone(base);
    copy.entityId = entityId;
    copy.payload.documentKind = documentKind;
    copy.payload.title = title;
    copy.payload.ownerRef = { tripId: base.tripId, ...ownerRef };
    copy.payload.sections = sections.map((section, order) => ({
      ...section,
      order,
      factRefs: [],
      assetRefs: [],
      linkRefs: [],
    }));
    copy.payload.factBindings = [];
    copy.payload.assetRefs = [];
    dataset.contents.push(copy);
    dataset.plans[0].contextRefs.push({
      tripId: base.tripId,
      targetKind: 'guide',
      entityId,
      revisionId: copy.revisionId,
    });
    dataset.heads.push({
      tripId: base.tripId,
      targetKind: 'guide',
      entityId,
      revisionId: copy.revisionId,
      status: 'active',
    });
  };
  const trip = { targetKind: 'trip' as const, entityId: base.tripId };
  addGuide(
    'region-guide-region-2',
    'region-2 · 지역 가이드',
    'region-guide',
    { targetKind: 'region', entityId: 'region-2' },
    [
      { key: 'body', title: '지역 본문', bodyMd: BODY },
      { key: 'source-frontmatter', title: '원천 지역 속성', bodyMd: '```text\nslug: region-2\n```' },
    ],
  );
  addGuide('source-document-howto', '01. 이 가이드북을 사용하는 법', 'preparation', trip, [
    { key: 'body', title: '원천 전체 본문', bodyMd: '이용법 본문' },
  ]);
  addGuide('source-document-schedule', '전체 일정', 'preparation', trip, [
    { key: 'body', title: '원천 전체 본문', bodyMd: '일정 본문' },
  ]);
  addGuide('source-document-cgm', 'Commercial Guide Module', 'preparation', trip, [
    { key: 'body', title: '원천 전체 본문', bodyMd: '상세 본문' },
  ]);
  // 지역 2의 상세 안내는 원천 파일 이름으로 지역에 묶이므로 지역 id가 파일 이름 토큰에 들어가게 한다.
  const cgm = dataset.contents.find((content) => content.entityId === 'source-document-cgm')!;
  cgm.sourceRefs = [
    {
      sourceKind: 'markdown',
      sourceKey: 'x.md',
      locator: 'x.md',
      sourcePath: 'source/CURRENT/20_Regional_Chapters/02_region-2_v1.0.md',
    },
  ];
  // 지역 이름을 원천 키 소문자 모양으로 바꾸지 않고, 상세 안내 파일 이름 토큰은 지역 id와 맞춘다.
  const region2 = dataset.contents.find((content) => content.entityId === 'region-2');
  if (region2?.kind === 'region') {
    region2.payload.guideIds = ['region-guide-region-2'];
  }
  // 1일차: 가상 장소 1의 사진이 날짜 사진이며 활동 1에 붙는다. 3일차는 사진이 없다.
  const place1 = dataset.contents.find((content) => content.entityId === 'shared-source-slug');
  if (place1?.kind === 'place') {
    place1.payload.assetRefs = [{ assetId: 'asset-image', role: 'hero', caption: '가상 장소 1 · 가상 저작자' }];
  }
  dataset.plans[0].days[0].assetRefs = [{ assetId: 'asset-image', role: 'hero', caption: '가상 장소 1 · 가상 저작자' }];
  const bytes = new Map<string, Uint8Array>();
  for (const value of Object.values(fixtureAssets)) {
    bytes.set(await digestBytes(value), value);
  }
  return buildPackage(dataset, bytes, {
    sourceRepository: 'fiction/review',
    sourceCommit: 'synthetic',
    lineageId: 'fiction-c15',
    adapterVersion: '1',
    normalizationVersion: '1',
  });
}

async function importSynthetic(page: Page, name: string) {
  await page.goto(space(name));
  await expect(page.getByRole('heading', { name: '어느 여행을 열까요?' })).toBeVisible();
  const packaged = await syntheticPackage();
  await page
    .locator('section.empty-start')
    .getByLabel('원천 패키지 가져오기 (pilot.zip)')
    .setInputFiles({
      name: 'fiction-c15.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from(await packaged.blob.arrayBuffer()),
    });
  await page.getByRole('button', { name: '여행에 추가', exact: true }).click();
}

test('Q1 여행 메모 대화상자 제목은 줄인 여행 이름을 쓴다', async ({ page }) => {
  await importSynthetic(page, 'c15-memo');
  await nav(page).getByRole('button', { name: '기록', exact: true }).click();
  await page.getByRole('button', { name: '여행 메모 쓰기', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('가상 대표 구간 (43일)');
  await expect(dialog).not.toContainText('Day 1·2');
});

test('Q2 준비·회화는 여행 전체 절이 먼저, 지역 절은 여행 순서이고 지역 접두가 없다', async ({ page }) => {
  await importSynthetic(page, 'c15-prep');
  await openMore(page, '준비·회화');
  const links = page.getByRole('navigation', { name: '여행 자료' });
  const titles = await links.getByRole('heading', { level: 3 }).allTextContents();
  expect(titles[0]).toBe('여행 전체');
  expect(titles.slice(1)).toEqual(['가상 지역 2']);
  const trip = links.getByRole('region', { name: '여행 전체' });
  expect(await trip.getByRole('button').allTextContents()).toEqual(['01. 이 가이드북을 사용하는 법', '전체 일정']);
  const region = links.getByRole('region', { name: '가상 지역 2' });
  expect(await region.getByRole('button').allTextContents()).toEqual(['지역 가이드', '지역 상세 안내']);
  await expect(links.getByText('Commercial Guide Module')).toHaveCount(0);
  await shot(page, 'q2-prep');
});

test('Q2 가이드 상세는 제목·목차·본문 순이고 편집은 메뉴 하나, 원천 정보는 맨 아래 접기다', async ({ page }) => {
  await importSynthetic(page, 'c15-detail');
  await openMore(page, '준비·회화');
  await page
    .getByRole('navigation', { name: '여행 자료' })
    .getByRole('region', { name: '가상 지역 2' })
    .getByRole('button', { name: '지역 가이드', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: '가상 지역 2 · 지역 가이드', level: 2 })).toBeVisible();
  // 편집 단추는 메뉴 안에만 있다.
  await expect(page.getByRole('button', { name: '가이드 제목 수정', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '지역 본문 편집', exact: true })).toHaveCount(0);
  await page.locator('.guide-head .menu-toggle').click();
  await expect(page.getByRole('button', { name: '가이드 제목 수정', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '지역 본문 편집', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  // 목차는 본문 머리말이고 눌러 이동한다. 전환 단추·원천 속성 섹션은 읽기 영역에 없다.
  const toc = page.getByRole('navigation', { name: '본문 목차' });
  expect(await toc.getByRole('button').allTextContents()).toEqual(['첫째 머리', '둘째 머리', '셋째 머리']);
  await toc.getByRole('button', { name: '셋째 머리', exact: true }).click();
  await expect(page.getByRole('heading', { name: '셋째 머리', level: 2 })).toBeInViewport();
  await expect(page.getByText('원천 지역 속성')).toBeHidden();
  const source = page.locator('details.guide-source-info');
  await expect(source.locator('summary')).toHaveText('원천 정보');
  await expect(source).not.toHaveAttribute('open', '');
  await source.locator('summary').click();
  await expect(source.getByText('slug: region-2')).toBeVisible();
  // 위·아래에 돌아가기가 있다.
  await expect(page.getByRole('button', { name: '준비·회화로', exact: true })).toHaveCount(2);
  await shot(page, 'q2-detail');
  await page.getByRole('button', { name: '준비·회화로', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: '준비·회화', level: 2 })).toBeVisible();
});

test('Q3 날짜 대표 사진과 활동 썸네일이 보이고 사진이 없는 날은 사진 없음이다', async ({ page }) => {
  await importSynthetic(page, 'c15-photo');
  await expect(page.locator('.day-cover')).toContainText('가상 장소 1');
  await expect(page.locator('.day-cover img')).toBeVisible();
  const firstCard = page.locator('article.timeline-stop').first();
  await expect(firstCard.locator('.activity-thumb')).toBeVisible();
  await expect(firstCard.locator('.activity-photo figcaption')).toHaveText('가상 장소 1');
  await expect(page.locator('article.timeline-stop').nth(1).locator('.activity-thumb')).toHaveCount(0);
  await shot(page, 'q3-day-photo');
  await page.locator('button[data-date="2026-11-02"]').click();
  await expect(page.locator('.day-photo-none')).toHaveText('사진 없음');
});

/** 실제 패키지 대조(읽기 전용). `C15_REAL_PACKAGE`(pilot.zip)와 같은 폴더의 dataset.json을 비교 기준으로 쓴다. 산출물은 커밋하지 않는 local-data에 둔다. */
test('실제 패키지 대조: 준비·회화 묶음, 가이드 상세, 43일 대표 사진', async ({ page }) => {
  test.setTimeout(900_000);
  test.skip(!process.env.C15_REAL_PACKAGE, 'C15_REAL_PACKAGE 없음');
  const zip = process.env.C15_REAL_PACKAGE!;
  const dataset = JSON.parse(await readFile(resolve(dirname(zip), 'dataset.json'), 'utf8'));
  await page.goto(space('c15-real'));
  await page.locator('section.empty-start').getByLabel('원천 패키지 가져오기 (pilot.zip)').setInputFiles(zip);
  const add = page.getByRole('button', { name: '여행에 추가', exact: true });
  await expect(add).toBeEnabled({ timeout: 120_000 });
  await add.click();
  await expect(page.locator('.trip-switch')).toBeVisible({ timeout: 180_000 });
  const directory = resolve('local-data/c15-real');
  await mkdir(directory, { recursive: true });
  const project = test.info().project.name;
  const take = (name: string) => page.screenshot({ path: resolve(directory, `${name}-${project}.png`) });
  const lines: string[] = [];

  await openMore(page, '준비·회화');
  const links = page.getByRole('navigation', { name: '여행 자료' });
  await expect(links.getByRole('button').first()).toBeVisible({ timeout: 60_000 });
  const sectionTitles = await links.getByRole('heading', { level: 3 }).allTextContents();
  lines.push(`PREP sections=${JSON.stringify(sectionTitles)}`);
  for (const section of await links.getByRole('region').all()) {
    lines.push(
      `PREP ${await section.getByRole('heading').textContent()}: ${(await section.getByRole('button').allTextContents()).join(' | ')}`,
    );
  }
  await take('q2-prep');
  await links.getByRole('region', { name: /Aix/ }).getByRole('button', { name: '지역 가이드', exact: true }).click();
  await expect(page.locator('.guide-toc')).toBeVisible();
  lines.push(
    `DETAIL h2="${await page.locator('article.guide-detail h2').first().textContent()}" toc=${await page.locator('.guide-toc button').count()} height=${await page.evaluate(() => document.documentElement.scrollHeight)}`,
  );
  await take('q2-detail');

  await nav(page).getByRole('button', { name: '오늘', exact: true }).click();
  const plan = dataset.plans[0];
  const places = dataset.contents.filter((content: { kind: string }) => content.kind === 'place');
  lines.push('DAYS date | 이전 대표 | 새 대표 | 사진 수 | 이유 | 화면 대표');
  for (const day of plan.days) {
    const result = planDayPhotos(day, plan.items, places);
    const before = result.photos.find((photo) => photo.order === 0)?.label ?? '사진 없음';
    await selectDayByDate(page, day.date);
    const shown = (await page.locator('.day-cover figcaption strong').count())
      ? await page.locator('.day-cover figcaption strong').first().textContent()
      : await page.locator('.day-photo-none').first().textContent();
    lines.push(
      `${day.date} | ${before} | ${result.cover?.label ?? '사진 없음'} | ${result.photos.length} | ${result.reason} | ${shown}`,
    );
    expect(shown).toBe(result.cover?.label ?? '사진 없음');
    if (day.date === '2026-09-07') {
      await take('q3-card');
      await page.locator('.day-cover').scrollIntoViewIfNeeded();
      await take('q3-cover');
    }
  }
  await writeFile(resolve(directory, 'c15-real.txt'), lines.join('\n'), 'utf8');
  console.log(`C15-REAL written ${lines.length} lines`);
});
