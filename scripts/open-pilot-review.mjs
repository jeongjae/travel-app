import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, expect } from '@playwright/test';
import { readPackage } from '../src/transfer/package.ts';

const { values } = parseArgs({ options: { package: { type: 'string' }, 'output-dir': { type: 'string' } } });
if (!values.package || !values['output-dir']) {
  throw new Error('--package --output-dir가 필요합니다.');
}
const root = await realpath('local-data');
function inside(path) {
  const rel = relative(root, path);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('실제 검토 자료는 local-data 하위에만 둡니다.');
  }
  return path;
}
const packagePath = inside(await realpath(values.package));
const packaged = await readPackage(new Blob([await readFile(packagePath)]));
const output = inside(resolve(values['output-dir']));
inside(await realpath(resolve(output, '..')));
await mkdir(output, { recursive: true });
inside(await realpath(output));
const profile = resolve(output, 'browser-profile');
// This dedicated profile is visible and persistent for the human review. No existing personal browser is controlled.
const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  viewport: { width: 1504, height: 1040 },
  serviceWorkers: 'allow',
  args: ['--window-size=1530,1140'],
});
const page = context.pages()[0] ?? (await context.newPage());
page.setDefaultTimeout(45000);
const url = 'http://127.0.0.1:4173/?workspace=content&review=phase-1';
try {
  await page.goto(url);
  await expect(
    page.getByText('검증용 저장소 · 평소 사용하는 여행 저장소와 분리되어 있습니다.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  if (await page.getByRole('heading', { name: '어느 여행을 열까요?', exact: true }).count()) {
    await page.getByLabel('여행 패키지 선택').setInputFiles(packagePath);
    await page.getByRole('button', { name: '여행에 추가', exact: true }).click();
  }
  await expect(page.getByRole('heading', { level: 1, name: packaged.dataset.header.name, exact: true })).toBeVisible();
  await page
    .getByRole('img')
    .first()
    .evaluate((image) => image.decode());
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: resolve(output, 'ready.png'), fullPage: false });
  const ready = {
    status: 'ready-for-user',
    url,
    profile,
    database: 'travel-app-review-phase-1',
    packagePath,
    packageDigest: packaged.provenance.packageDigest,
    userConfirmation: '확인 대기',
    note: '이 Chromium 창의 전용 프로필에만 적재. 다른 브라우저에서는 같은 URL을 열고 ZIP을 직접 선택해야 함. 실제 방문 기록이나 테스트 편집 문장을 넣지 않은 표본.',
  };
  await writeFile(resolve(output, 'ready.json'), JSON.stringify(ready, null, 2) + '\n');
  console.log(JSON.stringify({ status: ready.status, url, database: ready.database }));
  await context.waitForEvent('close', { timeout: 0 });
} catch (error) {
  await writeFile(resolve(output, 'failure.txt'), String(error) + '\n');
  await context.close();
  throw error;
}
