// 가상 여행 패키지를 앱에 가져오는 E2E 공용 동작.
import { expect, type Page } from '@playwright/test';
import { buildPackage } from '../../../src/transfer/package';
import { digestBytes } from '../../../src/contracts/v2';
import { fixtureAssets } from '../../fixtures/pilot';
import type { aiV2Fixture } from '../../fixtures/ai-v2';

type Fixture = Awaited<ReturnType<typeof aiV2Fixture>>;

export async function importTrip(page: Page, fixture: Fixture) {
  await page.goto('/?workspace=content');
  const assets = new Map<string, Uint8Array>();
  for (const bytes of Object.values(fixtureAssets)) {
    assets.set(await digestBytes(bytes), bytes);
  }
  const packaged = await buildPackage(fixture.dataset, assets, {
    sourceRepository: 'synthetic/ai-v2',
    sourceCommit: 'fictional-only',
    lineageId: 'synthetic-ai-d03',
    adapterVersion: '1',
    normalizationVersion: '2',
  });
  await page.getByLabel('원천 패키지 가져오기').setInputFiles({
    name: 'fictional-ai-d03.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(await packaged.blob.arrayBuffer()),
  });
  await page.getByRole('button', { name: '여행에 추가', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: fixture.dataset.header.name, exact: true })).toBeVisible();
}
