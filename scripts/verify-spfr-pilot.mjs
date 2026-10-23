import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, expect } from '@playwright/test';
import { canonicalJson, digestBytes } from '../src/contracts/v2/index.ts';
import { readPackage, datasetRows } from '../src/transfer/package.ts';
import { readBackup } from '../src/transfer/backup.ts';

const { values } = parseArgs({
  options: {
    package: { type: 'string' },
    extract: { type: 'string' },
    'output-dir': { type: 'string' },
  },
});
if (!values.package || !values.extract || !values['output-dir']) {
  throw new Error('--package --extract --output-dir가 필요합니다.');
}
const root = await realpath('local-data');
const inside = (path) => {
  const rel = relative(root, path);
  assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel), '검증 자료는 local-data 하위에 보관');
  return path;
};
const packagePath = inside(await realpath(values.package));
const extract = JSON.parse(await readFile(inside(await realpath(values.extract)), 'utf8'));
const output = inside(resolve(values['output-dir']));
inside(await realpath(resolve(output, '..')));
await mkdir(output);
inside(await realpath(output));
const packaged = await readPackage(new Blob([await readFile(packagePath)]));
const dataset = packaged.dataset;
const plan = dataset.plans[0];
const json = (path) => extract.entries.find((entry) => entry.sourceKey === path).rawValue;
const cards = plan.days.map((day) => json(`data/daily-cards/${day.dayId}.json`));
// Independent source-to-domain comparisons; no normalizer helpers are used here.
for (const [index, day] of plan.days.entries()) {
  const card = cards[index];
  assert.equal(day.date, card.date);
  for (const key of ['title', 'food', 'transport', 'highlights', 'needsReview']) {
    assert.deepEqual(day[key], card[key]);
  }
  assert.equal(day.backupText, card.backup);
  assert.deepEqual(day.sourceMetadata.mapCenter, card.map.center);
  assert.equal(day.sourceMetadata.mapZoom, card.map.zoom);
  for (const stop of card.stops) {
    const item = plan.items.find((item) => item.activityId === `${day.dayId}-${stop.id}`);
    assert.ok(item);
    for (const [target, source] of Object.entries({
      title: 'name',
      order: 'order',
      summary: 'summary',
      optional: 'optional',
      category: 'category',
    })) {
      assert.equal(item[target], stop[source]);
    }
    assert.equal(item.menuText ?? '', stop.menu ?? '');
    assert.equal(item.reservationText ?? '', stop.reservation ?? '');
    assert.equal(item.executionNote ?? '', stop.executionNote ?? '');
    assert.equal(item.officialUrl ?? '', stop.officialUrl ?? '');
    assert.deepEqual(
      item.executionMarkers,
      stop.executionStatuses.map((status) => ({ type: status.type, label: status.label, detail: status.detail ?? '' })),
    );
  }
}
const phraseBook = dataset.contents.find((content) => content.kind === 'phrase-book');
const sourcePhrases = json('data/travel-french-phrases.json').phrases;
assert.equal(phraseBook.payload.phrases.length, sourcePhrases.length);
for (const phrase of sourcePhrases) {
  const saved = phraseBook.payload.phrases.find((entry) => entry.id === phrase.id);
  for (const [target, source] of Object.entries({
    text: 'fr',
    translation: 'ko',
    pronunciationHint: 'pronunciation_hint',
    usageNote: 'usage_note',
    audioText: 'audio_text',
    tags: 'tags',
  })) {
    assert.deepEqual(saved[target], phrase[source]);
  }
  assert.equal(saved.priority, Number(phrase.priority.slice(1)));
}
assert.equal(dataset.records.length, 0, '표본 안에 원천 현장 상태가 없는 이번 입력에서 방문 기록을 발명하지 않음');
const browser = await chromium.launch({ headless: true, executablePath: undefined });
const context = await browser.newContext({ viewport: { width: 1504, height: 1040 }, serviceWorkers: 'allow' });
const page = await context.newPage();
page.setDefaultTimeout(45000);
const errors = [];
const foreignRequests = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') {
    errors.push(message.text());
  }
});
page.on('request', (request) => {
  if (/^https?:/.test(request.url()) && new URL(request.url()).hostname !== '127.0.0.1') {
    foreignRequests.push(request.url());
  }
});
const url = 'http://127.0.0.1:4173/?workspace=content&review=phase1-verification';
const button = (name) => page.getByRole('button', { name, exact: true });
const screenshot = async (name) => page.screenshot({ path: resolve(output, name), fullPage: false });
async function inspectFiles(targetPage, databaseName) {
  return targetPage.evaluate(async (name) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const collectionNames = [
        'workspace_meta',
        'trip_headers',
        'content_heads',
        'content_revisions',
        'plan_versions',
        'plan_days',
        'plan_items',
        'plan_legs',
        'plan_stays',
        'field_records',
        'proposal_revisions',
        'asset_blobs',
      ];
      const transaction = database.transaction(collectionNames);
      const rows = Object.fromEntries(
        await Promise.all(
          collectionNames.map(
            (collection) =>
              new Promise((resolve, reject) => {
                const request = transaction.objectStore(collection).getAll();
                request.onsuccess = () => resolve([collection, request.result]);
                request.onerror = () => reject(request.error);
              }),
          ),
        ),
      );
      const active = rows.workspace_meta[0].activeSpaceId;
      for (const name of collectionNames.filter((name) => name !== 'workspace_meta')) {
        rows[name] = rows[name].filter((row) => row.spaceId === active);
      }
      const assets = [];
      const origin = await navigator.storage.getDirectory();
      const root = await origin.getDirectoryHandle('travel-app-assets-v1');
      for (const row of rows.asset_blobs) {
        if (row.storage !== 'opfs' || row.bytes || !row.storageKey) {
          throw new Error('DB에 파일 참조 대신 바이트가 있거나 파일 키 누락');
        }
        const [database, scope, filename] = row.storageKey.split('/');
        const folder = await (await root.getDirectoryHandle(database)).getDirectoryHandle(scope);
        const file = await (await folder.getFileHandle(filename)).getFile();
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))]
          .map((value) => value.toString(16).padStart(2, '0'))
          .join('');
        assets.push({ hash, size: file.size, expectedHash: row.sha256, expectedSize: row.byteLength });
      }
      delete rows.workspace_meta;
      delete rows.asset_blobs;
      return { rows, assets };
    } finally {
      database.close();
    }
  }, databaseName);
}
async function decodeImages(targetPage) {
  const images = targetPage.locator('img');
  for (const image of await images.all()) {
    await image.evaluate((image) => image.decode());
    assert.ok(await image.evaluate((image) => image.naturalWidth > 0));
  }
  assert.ok(await targetPage.locator('body').evaluate((body) => body.scrollWidth <= innerWidth), '화면 가로 넘침 없음');
}
try {
  await page.goto(url);
  await page.getByLabel('여행 패키지 선택').setInputFiles(packagePath);
  await button('여행에 추가').click();
  await expect(page.getByRole('heading', { level: 1, name: dataset.header.name, exact: true })).toBeVisible();
  const initial = await inspectFiles(page, 'travel-app-review-phase1-verification');
  const expected = datasetRows(dataset);
  for (const [collection, rows] of Object.entries(initial.rows)) {
    const clean = (rows) =>
      rows
        .map((row) => {
          const { spaceId: _, ...value } = row;
          return canonicalJson(value);
        })
        .sort();
    assert.deepEqual(clean(rows), clean(expected[collection]), `원천 ZIP과 실제 DB의 ${collection} 전체 값 동일`);
  }
  for (const file of initial.assets) {
    assert.equal(file.hash, file.expectedHash);
    assert.equal(file.size, file.expectedSize);
    assert.ok(packaged.assets.has(file.hash));
  }
  assert.equal(initial.assets.length, packaged.assets.size);
  for (const day of plan.days) {
    await page.getByLabel('날짜').first().selectOption(day.dayId);
    await expect(page.getByRole('heading', { level: 2, name: day.title, exact: true })).toBeVisible();
    for (const item of plan.items.filter((item) => item.dayId === day.dayId)) {
      await expect(page.getByRole('heading', { name: item.title, exact: true })).toBeVisible();
      if (item.summary) {
        await expect(page.getByText(item.summary, { exact: true }).first()).toBeVisible();
      }
    }
    await decodeImages(page);
    await page.evaluate(() => scrollTo(0, 0));
    await screenshot(`${day.dayId}.png`);
  }
  const places = dataset.contents.filter((content) => content.kind === 'place');
  for (const place of places) {
    await button('장소·지역').click();
    await button(place.payload.name).click();
    const guide = dataset.contents.find(
      (content) => content.kind === 'guide' && content.entityId === place.payload.guideId,
    );
    for (const key of ['why_go', 'deep', 'practical']) {
      await expect(
        page.getByRole('heading', {
          level: 3,
          name: guide.payload.sections.find((section) => section.key === key).title,
          exact: true,
        }),
      ).toBeVisible();
    }
    await decodeImages(page);
    const uncertain = dataset.contents.some(
      (content) =>
        content.kind === 'fact' &&
        content.payload.targetRef.entityId === place.entityId &&
        content.payload.appReviewStatus === 'needs-review',
    );
    if (uncertain) {
      await expect(page.getByText('외부 근거 누락.', { exact: false })).toBeVisible();
      await screenshot('fact-needs-review.png');
    }
  }
  for (const region of dataset.contents.filter((content) => content.kind === 'region')) {
    await button('장소·지역').click();
    await button(region.payload.name).click();
    const original = extract.entries.find(
      (entry) => entry.sourceKey === `source/CURRENT/20_Regions/${region.entityId}.md`,
    ).rawValue;
    const visible = await page.locator('.guide-detail').innerText();
    for (const [title] of original.matchAll(/<[^>\r\n]+>/g)) {
      assert.ok(visible.includes(title), '지역 본문의 꺾쇠 전시명이 HTML로 사라지지 않음');
    }
    for (const id of region.payload.guideIds.slice(1)) {
      const linked = dataset.contents.find((content) => content.kind === 'guide' && content.entityId === id);
      await button(linked.payload.title).click();
      await expect(page.getByRole('heading', { level: 2, name: linked.payload.title, exact: true })).toBeVisible();
      await button('장소·지역').click();
      await button(region.payload.name).click();
    }
  }
  await button('준비·회화').click();
  await button('운영 통합문서 · 12시트 대조').click();
  const workbook = dataset.contents.find(
    (content) => content.kind === 'guide' && content.entityId === 'source-workbook',
  );
  for (const section of workbook.payload.sections) {
    await expect(page.getByRole('heading', { level: 3, name: section.title, exact: true })).toBeVisible();
  }
  await button('준비·회화').click();
  await button('프랑스어 발음·표지·메뉴').click();
  await expect(page.getByRole('heading', { level: 3, name: '발음·표지판', exact: true })).toBeVisible();
  await button('예약·할 일').click();
  const bookings = dataset.contents.filter((content) => content.kind === 'booking');
  for (const booking of bookings) {
    const titles = page.getByRole('heading', { name: booking.payload.title, exact: true });
    await expect(titles).toHaveCount(bookings.filter((entry) => entry.payload.title === booking.payload.title).length);
    await expect(titles.first()).toBeVisible();
  }
  await page.evaluate(() => scrollTo(0, 0));
  await screenshot('bookings.png');
  await button('준비·회화').click();
  await expect(page.getByText(sourcePhrases[0].fr, { exact: true }).first()).toBeVisible();
  await button('사진·관광 지도 · 오프라인 자료').click();
  await decodeImages(page);
  await page.evaluate(() => scrollTo(0, 0));
  await screenshot('gallery.png');
  const firstPlace = places[0];
  await button('장소·지역').click();
  await button(firstPlace.payload.name).click();
  const firstGuide = dataset.contents.find(
    (content) => content.kind === 'guide' && content.entityId === firstPlace.payload.guideId,
  );
  const practical = firstGuide.payload.sections.find((section) => section.key === 'practical');
  await button(`${practical.title} 편집`).click();
  const marker = '검증 사본에서 편집·복원을 확인한 문장';
  await page.getByLabel('본문 Markdown').fill(practical.bodyMd + '\n\n' + marker);
  await button('본문 저장').click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.reload();
  await button('장소·지역').click();
  await button(firstPlace.payload.name).click();
  await expect(page.getByText(marker, { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForTimeout(500);
  await context.setOffline(true);
  await page.reload();
  await button('일정').click();
  await button('예정 외 활동 기록').click();
  const recordTitle = '검증용 현장 기록 · 실제 방문 아님';
  await page.getByLabel('활동 이름').fill(recordTitle);
  await page.getByLabel('기록 메모').fill('오프라인 저장·재실행·전체 복원 검증용');
  await button('실제 기록 저장').click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.reload();
  await button('실제 기록').click();
  await expect(page.getByRole('heading', { name: recordTitle, exact: true })).toBeVisible();
  await screenshot('offline-record.png');
  await button('저장소·백업').click();
  await expect(page.getByText('오프라인 준비됨', { exact: false })).toHaveCount(initial.assets.length);
  await button('전체 백업 만들기').click();
  await expect(page.getByText('전체 백업 생성 완료', { exact: false })).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('link', { name: '검증한 전체 백업 파일 저장', exact: true }).click();
  const backupPath = resolve(output, 'verified-backup.zip');
  await (await downloadEvent).saveAs(backupPath);
  const backup = await readBackup(new Blob([await readFile(backupPath)]));
  assert.equal(backup.manifest.tripIds.length, 1);
  await button('닫기').click();
  const beforeRestore = await inspectFiles(page, 'travel-app-review-phase1-verification');
  const restore = await browser.newContext({ viewport: { width: 1504, height: 1040 }, serviceWorkers: 'allow' });
  const target = await restore.newPage();
  target.setDefaultTimeout(45000);
  target.on('pageerror', (error) => errors.push(error.message));
  await target.goto('http://127.0.0.1:4173/?workspace=content&review=phase1-restored');
  await target.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await target.waitForTimeout(500);
  await restore.setOffline(true);
  await target.reload();
  await target.getByRole('button', { name: '저장소·백업', exact: true }).click();
  await target.getByLabel('전체 백업 파일 선택').setInputFiles(backupPath);
  await expect(target.getByText('복원 미리보기: 1개 여행', { exact: false })).toBeVisible();
  await target.getByRole('button', { name: '확인 후 전체 복원', exact: true }).click();
  await expect(target.getByText('전체 복원 완료.', { exact: false })).toBeVisible();
  await target.getByRole('button', { name: '닫기', exact: true }).click();
  await target.reload();
  const restored = await inspectFiles(target, 'travel-app-review-phase1-restored');
  const cleanRows = (rows) =>
    Object.fromEntries(
      Object.entries(rows).map(([name, entries]) => [
        name,
        entries.map(({ spaceId: _, ...entry }) => canonicalJson(entry)).sort(),
      ]),
    );
  assert.deepEqual(cleanRows(restored.rows), cleanRows(beforeRestore.rows));
  assert.deepEqual(restored.assets.map((asset) => asset.hash).sort(), initial.assets.map((asset) => asset.hash).sort());
  await target.getByRole('button', { name: '장소·지역', exact: true }).click();
  await target.getByRole('button', { name: firstPlace.payload.name, exact: true }).click();
  await expect(target.getByText(marker, { exact: true })).toBeVisible();
  await decodeImages(target);
  await target.screenshot({ path: resolve(output, 'restored-guide.png'), fullPage: false });
  assert.deepEqual(errors, []);
  assert.deepEqual(foreignRequests, []);
  const report = {
    status: 'passed',
    checkedAt: new Date().toISOString(),
    sourceCommit: extract.sourceCommit,
    packageDigest: packaged.provenance.packageDigest,
    zipSha256: await digestBytes(new Uint8Array(await readFile(packagePath))),
    nativeSourceFieldsMatched: true,
    initialDatabaseAllRowsIdentical: true,
    daysViewed: plan.days.length,
    placeGuidesViewed: places.length,
    bookingsViewed: bookings.length,
    phrasesCompared: sourcePhrases.length,
    fileHashesVerified: initial.assets.length,
    bytes: initial.assets.reduce((sum, asset) => sum + asset.size, 0),
    mediaFiles: dataset.contents.filter((content) => content.kind === 'asset' && content.payload.assetKind !== 'other')
      .length,
    editReload: true,
    offlineRecordReload: true,
    offlineRestoreAllRowsIdentical: true,
    restoreFileHashesIdentical: true,
    browserErrors: 0,
    externalRequests: 0,
    userConfirmation: '사용자 확인 대기',
    limitation:
      'PC Chromium 검사. iPhone Chrome·실기기 용량/메모리는 미검증. 검증 입력은 별도 사본의 테스트이며 실제 방문이 아님.',
  };
  await writeFile(resolve(output, 'browser-verification.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(report));
  await restore.close();
} catch (error) {
  await screenshot('failure.png').catch(() => undefined);
  await writeFile(resolve(output, 'failure.txt'), String(error) + '\n');
  throw error;
} finally {
  await browser.close();
}
