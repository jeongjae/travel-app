import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, expect } from '@playwright/test';

/**
 * C-06 실제 사본 대조(1회). 읽기 전용으로 받은 패키지를 새 프로필의 검토 공간에 가져오고, 가상 수동 여행 하나를 더한 뒤
 * 전체 백업→다른 새 프로필의 빈 검토 공간으로 복원해 도메인 행·첨부 바이트 해시를 비교한다.
 * 실제 본문·예약·사진은 출력하지 않는다. 결과 JSON에는 경로·해시·수량·판정만 남기고 local-data 하위에만 쓴다.
 * 기존 사용자 DB·검토 프로필·ZIP은 열거나 바꾸지 않는다(입력 ZIP은 읽기만 한다).
 */
const { values } = parseArgs({
  options: { package: { type: 'string' }, 'output-dir': { type: 'string' }, 'review-id': { type: 'string' } },
});
if (!values.package || !values['output-dir'] || !values['review-id']) {
  throw new Error('--package --output-dir --review-id가 필요합니다.');
}
if (!/^[a-z0-9-]{1,30}$/.test(values['review-id'])) {
  throw new Error('검토 공간 이름이 잘못되었습니다.');
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
const output = inside(resolve(values['output-dir']));
await mkdir(output, { recursive: true });
inside(await realpath(output));

const sha256File = async (path) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
const fileFacts = async (path) => {
  const info = await stat(path);
  return { bytes: info.size, mtimeMs: info.mtimeMs, sha256: await sha256File(path) };
};
const inputBefore = await fileFacts(packagePath);

const sortedJson = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : 1)))
      : item,
  );
const DOMAIN = [
  'trip_headers',
  'content_heads',
  'content_revisions',
  'plan_versions',
  'plan_days',
  'plan_items',
  'plan_legs',
  'plan_stays',
  'field_records',
  'import_packages',
  'import_heads',
  'import_mappings',
  'proposal_heads',
  'proposal_revisions',
  'command_receipts',
];

/** 브라우저 안에서 모든 도메인 행을 읽고 첨부 바이트를 해시한다. 행 본문은 밖으로 내보내지 않고 행별 해시만 낸다. */
async function dump(page, reviewName) {
  return page.evaluate(
    async ({ dbName, domain }) => {
      const hex = async (buffer) =>
        [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))]
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
      const sorted = (value) =>
        JSON.stringify(value, (_key, item) =>
          item && typeof item === 'object' && !Array.isArray(item)
            ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : 1)))
            : item,
        );
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      const readAll = (name) =>
        new Promise((resolve, reject) => {
          const read = db.transaction(name).objectStore(name).getAll();
          read.onsuccess = () => resolve(read.result);
          read.onerror = () => reject(read.error);
        });
      const tables = {};
      for (const name of domain) {
        const rows = await readAll(name);
        const hashes = [];
        for (const row of rows) {
          const { spaceId: _space, ...rest } = row;
          hashes.push(await hex(new TextEncoder().encode(sorted(rest))));
        }
        tables[name] = { count: rows.length, rowHashes: hashes.sort() };
      }
      const blobs = await readAll('asset_blobs');
      const meta = await readAll('workspace_meta');
      db.close();
      const origin = await navigator.storage.getDirectory();
      const rootDir = await origin.getDirectoryHandle('travel-app-assets-v1');
      const assets = [];
      for (const row of blobs) {
        let buffer;
        if (row.storageKey) {
          const [database, scope, filename] = row.storageKey.split('/');
          const folder = await (await rootDir.getDirectoryHandle(database)).getDirectoryHandle(scope);
          buffer = await (await (await folder.getFileHandle(filename)).getFile()).arrayBuffer();
        } else {
          buffer = await row.bytes.arrayBuffer();
        }
        assets.push([
          `${row.tripId}/${row.sha256}`,
          row.byteLength,
          row.verified,
          await hex(buffer),
          buffer.byteLength,
        ]);
      }
      const spaces = new Set();
      for (const name of domain) {
        for (const row of await new Promise((resolve) => {
          const open = indexedDB.open(dbName);
          open.onsuccess = () => {
            const read = open.result.transaction(name).objectStore(name).getAll();
            read.onsuccess = () => {
              open.result.close();
              resolve(read.result);
            };
          };
        })) {
          spaces.add(row.spaceId);
        }
      }
      return { tables, assets: assets.sort(), spaceCount: spaces.size, activeSpace: meta[0]?.activeSpaceId };
    },
    { dbName: `travel-app-review-${reviewName}`, domain: DOMAIN },
  );
}

async function expand(page, selector) {
  const details = page.locator(selector);
  if ((await details.getAttribute('open')) === null) {
    await details.locator(':scope > summary').click();
  }
}
const base = 'http://127.0.0.1:4173';
const reviewSource = `${values['review-id']}-src`;
const reviewTarget = `${values['review-id']}-dst`;
const launch = (name) =>
  chromium.launchPersistentContext(resolve(output, name), { headless: true, serviceWorkers: 'allow' });

const report = { input: { path: 'redacted', ...inputBefore }, steps: [] };
const step = (name, detail) => {
  report.steps.push({ name, ...detail });
  console.log(name, JSON.stringify(detail));
};
const source = await launch('profile-src');
const sourcePage = source.pages()[0] ?? (await source.newPage());
sourcePage.setDefaultTimeout(180000);
const backupPath = resolve(output, 'full-backup.zip');
try {
  await sourcePage.goto(`${base}/?workspace=content&review=${reviewSource}`);
  await expect(sourcePage.getByText('검증용 저장소', { exact: false })).toBeVisible();
  const startTrips = await sourcePage.getByRole('navigation', { name: '여행 선택' }).getByRole('button').count();
  if (startTrips !== 0 && (await sourcePage.getByRole('heading', { name: '어느 여행을 열까요?' }).count()) === 0) {
    throw new Error('새 검토 공간이 비어 있지 않아 중단합니다.');
  }
  await expand(sourcePage, '.journey-library').catch(() => undefined);
  await sourcePage.getByLabel('여행 패키지 선택').setInputFiles(packagePath);
  await sourcePage.getByRole('button', { name: '여행에 추가', exact: true }).click();
  await expect(sourcePage.getByRole('heading', { level: 1 })).toBeVisible();
  await sourcePage.waitForTimeout(1500);
  await expect(sourcePage.getByRole('dialog')).not.toBeVisible({ timeout: 120000 });
  step('imported', { ok: true });

  // 가상 수동 여행 B(실제 사본과 공존).
  await expand(sourcePage, '.journey-library');
  await sourcePage.getByRole('button', { name: '새 여행', exact: true }).click();
  await sourcePage.getByLabel('여행 이름').fill('가상 수동 여행 B');
  await sourcePage.getByLabel('시작 날짜').fill('2032-06-01');
  await sourcePage.getByLabel('종료 날짜').fill('2032-06-03');
  await sourcePage.getByRole('button', { name: '여행 만들기', exact: true }).click();
  await expect(sourcePage.getByRole('heading', { name: '가상 수동 여행 B', exact: true, level: 1 })).toBeVisible();
  await sourcePage.getByRole('button', { name: '가이드', exact: true }).first().click();
  await sourcePage.getByRole('button', { name: '지역 작성', exact: true }).click();
  await sourcePage.getByLabel('지역 이름').fill('B 지역');
  await sourcePage.getByRole('button', { name: '지역 저장', exact: true }).click();
  await expect(sourcePage.getByRole('heading', { name: 'B 지역', exact: true, level: 2 })).toBeVisible();
  await expand(sourcePage, '.journey-extras');
  await sourcePage.getByRole('button', { name: '실제 기록', exact: true }).click();
  await sourcePage.getByRole('button', { name: '예정 외 활동 기록', exact: true }).click();
  await sourcePage.getByLabel('활동 이름').fill('B 가상 기록');
  await sourcePage.getByLabel('기록 메모').fill('B 가상 메모');
  await sourcePage.getByRole('button', { name: '실제 기록 저장', exact: true }).click();
  await expect(sourcePage.getByRole('dialog')).not.toBeVisible();
  step('virtual-trip-added', { ok: true });

  const before = await dump(sourcePage, reviewSource);
  const tripCount = before.tables.trip_headers.count;
  step('source-dump', {
    trips: tripCount,
    counts: Object.fromEntries(DOMAIN.map((n) => [n, before.tables[n].count])),
    assets: before.assets.length,
    assetBytes: before.assets.reduce((sum, a) => sum + a[1], 0),
    assetsVerified: before.assets.every((a) => a[2] && a[0].endsWith(`/${a[3]}`) && a[1] === a[4]),
  });
  expect(tripCount).toBe(2);

  await sourcePage.getByRole('button', { name: '저장소·백업', exact: true }).click();
  await sourcePage.getByRole('button', { name: '전체 백업 만들기', exact: true }).click();
  await expect(sourcePage.getByText('전체 백업 생성 완료', { exact: false })).toBeVisible({ timeout: 170000 });
  const download = sourcePage.waitForEvent('download');
  await sourcePage.getByRole('link', { name: '검증한 전체 백업 파일 저장' }).click();
  await (await download).saveAs(backupPath);
  const backupFacts = await fileFacts(backupPath);
  step('backup', { bytes: backupFacts.bytes, sha256: backupFacts.sha256 });

  const target = await launch('profile-dst');
  const targetPage = target.pages()[0] ?? (await target.newPage());
  targetPage.setDefaultTimeout(180000);
  try {
    await targetPage.goto(`${base}/?workspace=content&review=${reviewTarget}`);
    await expect(targetPage.getByText('검증용 저장소', { exact: false })).toBeVisible();
    await targetPage.getByRole('button', { name: '저장소·백업', exact: true }).click();
    await targetPage.getByLabel('전체 백업 파일 선택').setInputFiles(backupPath);
    await expect(targetPage.getByText('복원 미리보기: 2개 여행', { exact: false })).toBeVisible({ timeout: 170000 });
    await targetPage.getByRole('button', { name: '확인 후 전체 복원', exact: true }).click();
    await expect(targetPage.getByText('전체 복원 완료.', { exact: false })).toBeVisible({ timeout: 170000 });
    await targetPage.getByRole('button', { name: '닫기', exact: true }).click();
    await targetPage.reload();
    const after = await dump(targetPage, reviewTarget);
    const sameRows = DOMAIN.every(
      (n) => sortedJson(after.tables[n].rowHashes) === sortedJson(before.tables[n].rowHashes),
    );
    const sameAssets = sortedJson(after.assets) === sortedJson(before.assets);
    step('restored', {
      counts: Object.fromEntries(DOMAIN.map((n) => [n, after.tables[n].count])),
      sameDomainRows: sameRows,
      sameAssetBytesAndHashes: sameAssets,
      assets: after.assets.length,
      newSingleSpace: after.spaceCount === 1 && after.activeSpace !== before.activeSpace,
    });
    expect(sameRows).toBe(true);
    expect(sameAssets).toBe(true);
    // 복원 공간에서 두 여행이 모두 열린다(본문은 출력하지 않는다).
    await expand(targetPage, '.journey-library');
    const names = await targetPage.getByRole('navigation', { name: '여행 선택' }).getByRole('button').count();
    step('restored-trips-listed', { trips: names });
    expect(names).toBe(2);
  } finally {
    await target.close();
  }
} finally {
  await source.close();
}
const inputAfter = await fileFacts(packagePath);
report.inputUnchanged = inputAfter.sha256 === inputBefore.sha256 && inputAfter.mtimeMs === inputBefore.mtimeMs;
report.inputAfter = inputAfter;
await writeFile(resolve(output, 'result.json'), JSON.stringify(report, null, 2));
console.log('inputUnchanged', report.inputUnchanged);
if (!report.inputUnchanged) {
  process.exit(2);
}
