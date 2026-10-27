import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildPackage } from '../../src/transfer/package';
import { digestBytes, type TripDataset } from '../../src/contracts/v2';
import { fixtureAssets, pilotTrip } from '../fixtures/pilot';
import { factIsolation, factIsolationTrip } from '../fixtures/guide-fact-isolation';

// 가상 전용 검토 공간. 기존 사용자 DB(travel-app)와 다른 이름이며 테스트마다 빈 브라우저 컨텍스트에서 시작한다.
const reviewUrl = '/?workspace=content&review=fiction-fact-isolation';
const screenshotDirectory = resolve('.cache/t01-screenshots');
const otherTripName = '가상 미술 여행 B';
const otherPlaceName = '가상 전시관 B';

let browserErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      browserErrors.push(message.text());
    }
  });
});
test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) {
    expect(browserErrors).toEqual([]);
    expect(await page.locator('vite-error-overlay').count()).toBe(0);
    expect(await page.locator('body').evaluate((element) => element.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

async function packageFile(dataset: TripDataset, lineageId: string, sourceCommit: string) {
  const assets = new Map<string, Uint8Array>();
  for (const bytes of Object.values(fixtureAssets)) {
    assets.set(await digestBytes(bytes), bytes);
  }
  const packaged = await buildPackage(dataset, assets, {
    sourceRepository: 'fiction/fact-isolation',
    sourceCommit,
    lineageId,
    adapterVersion: '1',
    normalizationVersion: '1',
  });
  return {
    name: `${lineageId}-${sourceCommit}.zip`,
    mimeType: 'application/zip',
    buffer: Buffer.from(await packaged.blob.arrayBuffer()),
  };
}

async function expand(page: Page, selector: string) {
  const details = page.locator(selector);
  if ((await details.getAttribute('open')) === null) {
    await details.locator(':scope > summary').click();
  }
}

async function addPackage(page: Page, file: Awaited<ReturnType<typeof packageFile>>) {
  await expand(page, '.journey-library');
  await page.getByLabel('여행 패키지 선택').setInputFiles(file);
  await page.getByRole('button', { name: '여행에 추가', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}

async function selectTrip(page: Page, name: string) {
  await expand(page, '.journey-library');
  await page.getByRole('navigation', { name: '여행 선택' }).getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible();
}

async function openGuide(page: Page, placeName: string) {
  await page.getByRole('button', { name: '가이드', exact: true }).click();
  await page.getByRole('button', { name: placeName, exact: true }).click();
  await expect(page.getByRole('heading', { name: '실용', exact: true })).toBeVisible();
}

/** 열린 가이드의 실용 섹션이 기대한 Fact 값과 상태 한 줄만 보여준다. */
async function expectFact(page: Page, value: string, status: string, absentValues: string[]) {
  const practical = page.locator('section', { has: page.getByRole('heading', { name: '실용', exact: true }) });
  await expect(practical.getByText(value, { exact: false })).toBeVisible();
  await expect(practical.locator('.fact-status')).toHaveText(status);
  for (const absent of absentValues) {
    await expect(page.getByText(absent, { exact: false })).toHaveCount(0);
  }
}

async function shoot(page: Page, name: string) {
  await mkdir(screenshotDirectory, { recursive: true });
  const status = page.locator('.fact-status');
  if ((await status.count()) > 0) {
    await status.first().evaluate((element) => element.scrollIntoView({ block: 'center' }));
  }
  const project = test.info().project.name;
  await page.screenshot({ path: resolve(screenshotDirectory, `${project}-${name}.png`), fullPage: false });
}

async function updatedFactPackage() {
  const dataset = await factIsolationTrip();
  const fact = dataset.contents.find(
    (content) => content.kind === 'fact' && content.entityId === factIsolation.guideA.factId,
  );
  if (fact?.kind !== 'fact') {
    throw new Error('A Fact fixture가 없습니다.');
  }
  fact.payload.valueText = factIsolation.valueAUpdated;
  fact.payload.appReviewStatus = 'needs-review';
  fact.payload.sourceConfidence = 'fixture-reviewed-a2';
  fact.payload.verifiedAt = { precision: 'date', date: '2026-03-03' };
  return packageFile(dataset, 'fiction-fact-isolation', 'synthetic-v2');
}

test('같은 r1·같은 토큰의 두 가이드가 처음부터 각자의 Fact 값과 확인 상태를 보여준다', async ({ page }) => {
  await page.goto(reviewUrl);
  await addPackage(page, await packageFile(await factIsolationTrip(), 'fiction-fact-isolation', 'synthetic-v1'));
  await expect(page.getByRole('heading', { name: factIsolation.tripName, exact: true, level: 1 })).toBeVisible();

  await openGuide(page, factIsolation.guideA.placeName);
  await expectFact(page, factIsolation.valueA, factIsolation.statusA, [factIsolation.valueB]);
  await shoot(page, 'fact-a-initial');

  await openGuide(page, factIsolation.guideB.placeName);
  await expectFact(page, factIsolation.valueB, factIsolation.statusB, [factIsolation.valueA]);
  await shoot(page, 'fact-b-initial');

  await openGuide(page, factIsolation.guideA.placeName);
  await expectFact(page, factIsolation.valueA, factIsolation.statusA, [factIsolation.valueB]);
});

test('A의 Fact만 새 revision이 되면 A만 갱신되고 A→B→A·재로드·과거 계획·다른 여행이 구분된다', async ({ page }) => {
  await page.goto(reviewUrl);
  await addPackage(page, await packageFile(await factIsolationTrip(), 'fiction-fact-isolation', 'synthetic-v1'));
  await addPackage(page, await packageFile(await pilotTrip(true), 'fiction-fact-other', 'synthetic-v1'));
  await openGuide(page, otherPlaceName);
  await expect(page.getByText(factIsolation.otherTripValue, { exact: false })).toBeVisible();

  // 기존 재가져오기 명령(ApplyReimport)으로 A 여행의 Fact만 새 원천 값으로 반영한다.
  await selectTrip(page, factIsolation.tripName);
  await expand(page, '.journey-library');
  await page.getByLabel('여행 패키지 선택').setInputFiles(await updatedFactPackage());
  await page.getByRole('button', { name: '재가져오기 차이 검토', exact: true }).click();
  await expect(page.getByRole('heading', { name: '재가져오기 차이 검토', exact: true })).toBeVisible();
  await shoot(page, 'reimport-review');
  await page.getByRole('button', { name: '검토한 선택 적용', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();

  await openGuide(page, factIsolation.guideA.placeName);
  await expectFact(page, factIsolation.valueAUpdated, factIsolation.statusAUpdated, [
    factIsolation.valueA,
    factIsolation.valueB,
  ]);
  await shoot(page, 'fact-a-updated');
  await openGuide(page, factIsolation.guideB.placeName);
  await expectFact(page, factIsolation.valueB, factIsolation.statusB, [factIsolation.valueAUpdated]);
  await shoot(page, 'fact-b-unchanged');
  await openGuide(page, factIsolation.guideA.placeName);
  await expectFact(page, factIsolation.valueAUpdated, factIsolation.statusAUpdated, [factIsolation.valueB]);

  await page.reload();
  await openGuide(page, factIsolation.guideA.placeName);
  await expectFact(page, factIsolation.valueAUpdated, factIsolation.statusAUpdated, [factIsolation.valueB]);
  await openGuide(page, factIsolation.guideB.placeName);
  await expectFact(page, factIsolation.valueB, factIsolation.statusB, [factIsolation.valueAUpdated]);

  // 과거 계획(plan-1)에 고정된 context는 갱신 전 Fact를 계속 읽고, 선택을 풀면 현재 값으로 돌아온다.
  await expand(page, '.journey-extras');
  await expand(page, '.journey-settings');
  await page.getByLabel('계획 버전').selectOption('plan-1');
  await page.getByRole('button', { name: factIsolation.guideA.placeName, exact: true }).click();
  await expect(page.getByText('당시 고정 내용', { exact: false })).toBeVisible();
  await expectFact(page, factIsolation.valueA, factIsolation.statusA, [factIsolation.valueAUpdated]);
  await shoot(page, 'fact-a-past-plan');
  await page.getByLabel('계획 버전').selectOption('');
  await page.getByRole('button', { name: factIsolation.guideA.placeName, exact: true }).click();
  await expect(page.getByText('현재 내용', { exact: false })).toBeVisible();
  await expectFact(page, factIsolation.valueAUpdated, factIsolation.statusAUpdated, [factIsolation.valueA]);

  // 다른 여행은 같은 ID·r1·토큰을 써도 자기 값을 유지한다.
  await selectTrip(page, otherTripName);
  await openGuide(page, otherPlaceName);
  await expect(page.getByText(factIsolation.otherTripValue, { exact: false })).toBeVisible();
  await expect(page.getByText(factIsolation.valueAUpdated, { exact: false })).toHaveCount(0);
  await shoot(page, 'other-trip');
});
