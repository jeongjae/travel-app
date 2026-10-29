import { test, expect, type Page } from '@playwright/test';
import { buildPackage } from '../../src/transfer/package';
import { pilotTrip, fixtureAssets } from '../fixtures/pilot';
import { digestBytes } from '../../src/contracts/v2';
import type { TripDataset } from '../../src/contracts/v2';

/**
 * 계획 단위 재가져오기 화면(가상 fixture만): 같은 입력은 차이가 없고, 실제 원천 변경은 원본 변경,
 * 앱 수정과 겹치면 충돌이며 보류하면 앱 수정이 그대로 남는다.
 */
async function expand(page: Page, selector: string) {
  const details = page.locator(selector);
  if ((await details.getAttribute('open')) === null) {
    await details.locator(':scope > summary').click();
  }
}

async function seed(page: Page) {
  await page.goto('/?workspace=content');
  await expand(page, '.journey-library');
  await page.getByRole('button', { name: '가상 여행 둘러보기', exact: true }).click();
  await page.getByRole('button', { name: '가상 산책 여행 A · 3일', exact: true }).click();
  await page.getByRole('button', { name: '여행에 추가', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('heading', { name: '가상 산책 여행 A', exact: true, level: 1 })).toBeVisible();
}

async function openReview(page: Page, edit?: (trip: TripDataset) => void) {
  const trip = await pilotTrip();
  edit?.(trip);
  const assets = new Map<string, Uint8Array>();
  for (const bytes of Object.values(fixtureAssets)) {
    assets.set(await digestBytes(bytes), bytes);
  }
  const built = await buildPackage(trip, assets, {
    sourceRepository: 'synthetic/pilot',
    sourceCommit: 'synthetic-v2',
    lineageId: 'synthetic-pilot',
    adapterVersion: '1',
    normalizationVersion: 'pilot-v1',
  });
  await expand(page, '.journey-library');
  await page.getByLabel('여행 패키지 선택').setInputFiles({
    name: 'plan-source.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(await built.blob.arrayBuffer()),
  });
  await page.getByRole('button', { name: '재가져오기 차이 검토', exact: true }).click();
  await expect(page.getByRole('heading', { name: '재가져오기 차이 검토', exact: true })).toBeVisible();
}

const renameFirstSourceActivity = (trip: TripDataset) => {
  trip.plans[0].items[0].title = '새 원천 활동 제목';
};

async function editFirstActivityInApp(page: Page) {
  await page.getByRole('button', { name: '오늘', exact: true }).click();
  await page.getByRole('button', { name: '일정 수정', exact: true }).first().click();
  await page.getByLabel('활동 제목').fill('앱에서 고친 활동');
  await page.getByRole('button', { name: '계획 저장', exact: true }).click();
  await expect(page.getByRole('heading', { name: '앱에서 고친 활동', exact: true })).toBeVisible();
}

test('계획 재가져오기: 같은 입력은 계획 차이를 만들지 않는다', async ({ page }) => {
  await seed(page);
  await openReview(page);
  await expect(page.getByText('0개 차이', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^plan \/ current-plan/ })).toHaveCount(0);
});

test('계획 재가져오기: 실제 원천 변경은 원본 변경으로 보이고 선택해 적용한다', async ({ page }) => {
  await seed(page);
  await openReview(page, renameFirstSourceActivity);
  await expect(page.getByRole('heading', { name: 'plan / current-plan / 전체' })).toBeVisible();
  await expect(page.getByText('원본 변경', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: '검토한 선택 적용', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: '오늘', exact: true }).click();
  await expect(page.getByRole('heading', { name: '새 원천 활동 제목', exact: true })).toBeVisible();
});

test('계획 재가져오기: 앱 수정과 새 원천 변경이 겹치면 충돌이고 보류하면 앱 수정이 남는다', async ({ page }) => {
  await seed(page);
  await editFirstActivityInApp(page);
  await openReview(page, renameFirstSourceActivity);
  await expect(page.getByText('양쪽 수정 충돌', { exact: true })).toBeVisible();
  await expect(page.getByLabel('반영 선택 current-plan 전체')).toHaveValue('defer');
  await page.getByRole('button', { name: '검토한 선택 적용', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: '오늘', exact: true }).click();
  await expect(page.getByRole('heading', { name: '앱에서 고친 활동', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '새 원천 활동 제목', exact: true })).toHaveCount(0);
});
