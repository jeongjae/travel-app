import { test, expect, type Page, type Browser } from '@playwright/test';
import { buildPackage } from '../../src/transfer/package';
import { pilotTrip, fixtureAssets } from '../fixtures/pilot';
import { canonicalJson, digestBytes } from '../../src/contracts/v2';
import type { TripDataset } from '../../src/contracts/v2';

/**
 * C-06〔T-C7〕 통합 검증(가상 자료만). 가져온 여행 A(계보 있음)와 앱에서 만든 여행 B를 한 검토 공간에 두고
 * 전체 백업→빈 공간 복원, 재가져오기 보존, 회고→당시 근거 본문→회고 복귀를 확인한다.
 * 기존 사용자 공간·실제 ZIP은 쓰지 않는다. 검토 공간 이름은 시험마다 따로 둔다.
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

const EVIDENCE_THEN = '가상 표본 근거';
const EVIDENCE_NOW = '새 원천 근거 본문';
const A_NAME = '가상 산책 여행 A';
const B_NAME = '가상 수동 여행 B';

async function expand(page: Page, selector: string) {
  const details = page.locator(selector);
  if ((await details.getAttribute('open')) === null) {
    await details.locator(':scope > summary').click();
  }
}
async function openTab(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).first().click();
}
async function openExtra(page: Page, name: string) {
  await expand(page, '.journey-extras');
  await page.getByRole('button', { name, exact: true }).click();
}
async function selectTrip(page: Page, name: string) {
  await expand(page, '.journey-library');
  await page.getByRole('navigation', { name: '여행 선택' }).getByRole('button', { name }).click();
  await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible();
}
const space = (name: string) => `/?workspace=content&review=${name}`;

/** 가져오기 패키지(가상). 변경 함수로 새 원천 상태를 만든다. */
async function packageFile(name: string, edit?: (trip: TripDataset) => void) {
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
  return { name, mimeType: 'application/zip', buffer: Buffer.from(await built.blob.arrayBuffer()) };
}
const changeEvidence = (trip: TripDataset) => {
  const evidence = trip.contents.find((c) => c.kind === 'evidence' && c.entityId === 'evidence-1');
  if (evidence?.kind === 'evidence') {
    evidence.payload.claim = EVIDENCE_NOW;
  }
};
const changeEvidenceAndFirstActivity = (trip: TripDataset) => {
  changeEvidence(trip);
  trip.plans[0].items[0].title = '새 원천 활동 제목';
};
async function openReview(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  await expand(page, '.journey-library');
  await page.getByLabel('여행 패키지 선택').setInputFiles(file);
  await page.getByRole('button', { name: '재가져오기 차이 검토', exact: true }).click();
  await expect(page.getByRole('heading', { name: '재가져오기 차이 검토', exact: true })).toBeVisible();
}
/** 검토 대화상자의 단위(제목·상태·선택)를 읽는다. */
async function reviewUnits(page: Page) {
  return page.getByRole('dialog').evaluate((dialog) =>
    [...dialog.querySelectorAll('section.review-unit')].map((section) => ({
      heading: section.querySelector('h3')?.textContent ?? '',
      status: section.querySelector('p')?.textContent ?? '',
      choice: (section.querySelector('select') as HTMLSelectElement).value,
    })),
  );
}
async function closeDialog(page: Page) {
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^(닫기|취소)$/ })
    .first()
    .click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}

// ───────── 저장소 덤프(도메인 행·첨부 바이트) ─────────
type Dump = {
  tables: Record<string, Record<string, unknown>[]>;
  assets: {
    tripId: string;
    sha256: string;
    byteLength: number;
    verified: boolean;
    actualSha256: string;
    actualSize: number;
  }[];
};
async function dump(page: Page, review: string): Promise<Dump> {
  return page.evaluate(async (dbName) => {
    const sha = async (bytes: ArrayBuffer) =>
      [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const tables: Record<string, Record<string, unknown>[]> = {};
    const blobs: Record<string, unknown>[] = [];
    for (const name of [...db.objectStoreNames]) {
      const rows = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const read = db.transaction(name).objectStore(name).getAll();
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error);
      });
      if (name === 'asset_blobs') {
        blobs.push(...rows);
      } else {
        tables[name] = rows;
      }
    }
    db.close();
    const origin = await navigator.storage.getDirectory();
    const root = await origin.getDirectoryHandle('travel-app-assets-v1');
    const assets = [];
    for (const row of blobs as {
      tripId: string;
      sha256: string;
      byteLength: number;
      verified: boolean;
      storageKey?: string;
      bytes?: Blob;
    }[]) {
      let buffer: ArrayBuffer;
      if (row.storageKey) {
        const [database, scope, filename] = row.storageKey.split('/');
        const folder = await (await root.getDirectoryHandle(database)).getDirectoryHandle(scope);
        buffer = await (await (await folder.getFileHandle(filename)).getFile()).arrayBuffer();
      } else {
        buffer = await row.bytes!.arrayBuffer();
      }
      assets.push({
        tripId: row.tripId,
        sha256: row.sha256,
        byteLength: row.byteLength,
        verified: row.verified,
        actualSha256: await sha(buffer),
        actualSize: buffer.byteLength,
      });
    }
    return { tables, assets };
  }, `travel-app-review-${review}`);
}
/** 도메인 행만 비교한다. spaceId와 복원 작업 메타(transfer/staged/snapshot/workspace_meta)는 의도된 차이다. */
const DOMAIN_TABLES = [
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
] as const;
function domain(d: Dump, tripId?: string) {
  const out: Record<string, string[]> = {};
  for (const name of DOMAIN_TABLES) {
    out[name] = (d.tables[name] ?? [])
      .filter((row) => !tripId || row.tripId === tripId)
      .map((row) => {
        const { spaceId: _spaceId, ...rest } = row;
        return canonicalJson(rest);
      })
      .sort();
  }
  return out;
}
const counts = (d: Dump) => Object.fromEntries(DOMAIN_TABLES.map((name) => [name, (d.tables[name] ?? []).length]));
const tripIdOf = (d: Dump, name: string) =>
  (d.tables.trip_headers.find((h) => (h as { name?: string }).name === name) as { tripId: string }).tripId;
const spaceIds = (d: Dump) =>
  new Set(DOMAIN_TABLES.flatMap((name) => (d.tables[name] ?? []).map((row) => row.spaceId)));

// ───────── 시나리오 구성 ─────────
async function seedA(page: Page) {
  await expand(page, '.journey-library');
  await page.getByRole('button', { name: '가상 여행 둘러보기', exact: true }).click();
  await page.getByRole('button', { name: `${A_NAME} · 3일`, exact: true }).click();
  await page.getByRole('button', { name: '여행에 추가', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('heading', { name: A_NAME, exact: true, level: 1 })).toBeVisible();
}
async function applyMockProposal(page: Page) {
  await openExtra(page, '변경안');
  await page.getByRole('button', { name: '모의 변경안 만들기', exact: true }).click();
  await page.getByRole('button', { name: '미적용 초안 저장', exact: true }).click();
  // 가져온 A에는 처음부터 미적용 변경안이 있다. 방금 만든 변경안만 적용한다.
  await page
    .locator('article', { hasText: '가상 상황에 따른 변경' })
    .getByRole('button', { name: '확인 후 적용', exact: true })
    .click();
  await expect(page.getByText('적용됨', { exact: false }).first()).toBeVisible();
}
async function addAppOnlyContent(page: Page) {
  await openTab(page, '가이드');
  await page.getByRole('button', { name: '지역 작성', exact: true }).click();
  await page.getByLabel('지역 이름').fill('앱 전용 지역');
  await page.getByRole('button', { name: '지역 저장', exact: true }).click();
  await expect(page.getByRole('heading', { name: '앱 전용 지역', exact: true, level: 2 })).toBeVisible();
  await page.getByRole('button', { name: '목록으로', exact: true }).click();
  await page.getByRole('button', { name: '장소 작성', exact: true }).click();
  await page.getByLabel('장소 이름').fill('앱 전용 장소');
  await page.getByLabel('한 줄 요약').fill('앱에서 만든 요약');
  await page.getByLabel('앱 전용 지역', { exact: true }).check();
  await page.getByLabel('왜 가는가 (필수)').fill('앱 이유');
  await page.getByRole('button', { name: '장소 저장', exact: true }).click();
  await expect(page.getByRole('heading', { name: '앱 전용 장소', exact: true, level: 2 })).toBeVisible();
}
async function addAppActivity(page: Page, title: string) {
  await openTab(page, '오늘');
  await page.getByRole('button', { name: '활동 추가', exact: true }).click();
  await page.getByLabel('활동 제목').fill(title);
  await page.getByRole('button', { name: '계획 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}
async function recordUnplanned(page: Page, title: string, note: string, place?: string) {
  await page.getByRole('button', { name: '예정 외 활동 기록', exact: true }).click();
  await page.getByLabel('활동 이름').fill(title);
  if (place) {
    await page.getByLabel('기록할 장소').selectOption({ label: place });
  }
  await page.getByLabel('기록 메모').fill(note);
  await page.getByRole('button', { name: '실제 기록 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}
async function correctRecord(page: Page, title: string, note: string) {
  await page
    .locator('article.content-row', { hasText: title })
    .getByRole('button', { name: '정정', exact: true })
    .click();
  await page.getByLabel('기록 메모').fill(note);
  await page.getByRole('button', { name: '실제 기록 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}
async function createB(page: Page) {
  await expand(page, '.journey-library');
  await page.getByRole('button', { name: '새 여행', exact: true }).click();
  await page.getByLabel('여행 이름').fill(B_NAME);
  await page.getByLabel('시작 날짜').fill('2032-06-01');
  await page.getByLabel('종료 날짜').fill('2032-06-03');
  await page.getByRole('button', { name: '여행 만들기', exact: true }).click();
  await expect(page.getByRole('heading', { name: B_NAME, exact: true, level: 1 })).toBeVisible();
  await openTab(page, '가이드');
  await page.getByRole('button', { name: '지역 작성', exact: true }).click();
  await page.getByLabel('지역 이름').fill('B 지역');
  await page.getByRole('button', { name: '지역 저장', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'B 지역', exact: true, level: 2 })).toBeVisible();
  await page.getByRole('button', { name: '목록으로', exact: true }).click();
  await page.getByRole('button', { name: '장소 작성', exact: true }).click();
  await page.getByLabel('장소 이름').fill('B 카페');
  await page.getByLabel('한 줄 요약').fill('B 처음 요약');
  await page.getByLabel('B 지역', { exact: true }).check();
  await page.getByLabel('왜 가는가 (필수)').fill('B 이유');
  await page.getByRole('button', { name: '장소 저장', exact: true }).click();
  await addAppActivity(page, 'B 산책');
  await addAppActivity(page, 'B 식사');
  await applyMockProposal(page);
  await openExtra(page, '실제 기록');
  await recordUnplanned(page, 'B 우연한 카페', 'B 처음 메모', 'B 카페');
  await correctRecord(page, 'B 우연한 카페', 'B 둘째 메모');
  await correctRecord(page, 'B 우연한 카페', 'B 셋째 메모');
}
/** A: 가져오기→변경안 적용(원천 근거 포함)→앱 전용 콘텐츠·활동·현장 기록·정정→새 원천의 근거 변경 반영. */
async function buildA(page: Page) {
  await seedA(page);
  await applyMockProposal(page);
  await addAppOnlyContent(page);
  await addAppActivity(page, '앱에서 추가한 활동');
  await openExtra(page, '실제 기록');
  await recordUnplanned(page, 'A 앱 현장 기록', 'A 처음 메모', '앱 전용 장소');
  await correctRecord(page, 'A 앱 현장 기록', 'A 정정 메모');
}
/** 새 원천에서 근거 본문만 바뀐 패키지를 반영한다(근거는 원본 변경, 계획은 앱에서 수정됨). */
async function reimportEvidence(page: Page) {
  await openReview(page, await packageFile('evidence-source.zip', changeEvidence));
  const units = await reviewUnits(page);
  expect(units.find((u) => u.heading.startsWith('evidence / evidence-1'))).toMatchObject({
    status: '원본 변경',
    choice: 'remote',
  });
  expect(units.find((u) => u.heading.startsWith('plan / current-plan'))).toMatchObject({
    status: '앱에서만 수정',
    choice: 'local',
  });
  await page.getByRole('button', { name: '검토한 선택 적용', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}

/** 앱에서 만든 콘텐츠(이름이 '앱 전용')의 head 행. 재가져오기 전후 그대로여야 한다. */
function appOnlyHeads(d: Dump, tripId: string) {
  const ids = new Set(
    d.tables.content_revisions
      .filter((r) => r.tripId === tripId && String((r.payload as { name?: string }).name ?? '').startsWith('앱 전용'))
      .map((r) => r.entityId),
  );
  expect(ids.size).toBeGreaterThanOrEqual(2);
  return d.tables.content_heads
    .filter((h) => h.tripId === tripId && ids.has(h.entityId))
    .map((h) => {
      const { spaceId: _spaceId, ...rest } = h;
      return canonicalJson(rest);
    })
    .sort();
}
/** 충돌 패키지 검토(적용 없이): 단위 목록과 선택을 읽고 닫는다. 검토 준비는 아무것도 쓰지 않아야 한다. */
async function conflictReviewSnapshot(page: Page, review: string) {
  const before = await dump(page, review);
  await openReview(page, await packageFile('conflict-source.zip', changeEvidenceAndFirstActivity));
  const units = await reviewUnits(page);
  await closeDialog(page);
  expect(domain(await dump(page, review))).toEqual(domain(before));
  return units;
}

// ───────── 화면 재조회 ─────────
async function readAppOnly(page: Page) {
  await openTab(page, '가이드');
  await expect(page.getByRole('button', { name: '앱 전용 장소', exact: true })).toBeVisible();
  await openTab(page, '오늘');
  await expect(page.getByText('앱에서 추가한 활동', { exact: false })).toBeVisible();
}
async function openRetro(page: Page) {
  await openExtra(page, '실제 기록');
  await page.getByRole('button', { name: '날짜별 회고 보기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '날짜별 회고', exact: true })).toBeVisible();
}
/** 회고(적용 변경안의 근거)→당시 근거 본문→같은 날짜·버전 회고 복귀. 조회 전후 선택이 같아야 한다. */
async function evidenceRoundTrip(page: Page) {
  await openRetro(page);
  const retro = page.getByRole('region', { name: '날짜별 회고' });
  const dates = await retro
    .getByLabel('회고 날짜')
    .locator('option')
    .evaluateAll((o) => o.map((e) => (e as HTMLOptionElement).value));
  const planDate = dates.find((value) => /^[0-9]{4}-/.test(value));
  expect(planDate, dates.join(' | ')).toBeTruthy();
  await retro.getByLabel('회고 날짜').selectOption(planDate!);
  const options = await retro.getByLabel('회고 계획 버전').locator('option').allTextContents();
  // 변경안을 적용해 만든 계획(계획 이유 '가상 상황에 따른 변경')의 근거를 연다. 그 계획이 현재일 때는 현재 열의 이유에서 읽힌다.
  const past =
    options.find((text) => text.startsWith('과거 계획') && text.includes('가상 상황')) ??
    options.find((text) => text.startsWith('과거 계획'));
  expect(past, options.join(' | ')).toBeTruthy();
  await retro.getByLabel('회고 계획 버전').selectOption({ label: past! });
  const picked = await selection(retro);
  await retro
    .getByRole('button', { name: `근거 · ${EVIDENCE_THEN} (당시 내용)` })
    .first()
    .click();
  await expect(page.getByText('당시 고정 내용', { exact: true })).toBeVisible();
  await expect(page.getByText(EVIDENCE_THEN, { exact: true })).toBeVisible();
  await expect(page.getByText(EVIDENCE_NOW, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /수정|본문 저장|정정/ })).toHaveCount(0);
  await page.getByRole('button', { name: '실제 기록으로 돌아가기', exact: true }).click();
  expect(await selection(page.getByRole('region', { name: '날짜별 회고' }))).toEqual(picked);
}
async function selection(retro: ReturnType<Page['getByRole']>) {
  return {
    date: await retro.getByLabel('회고 날짜').inputValue(),
    plan: await retro.getByLabel('회고 계획 버전').inputValue(),
  };
}

async function backupTo(page: Page, file: string) {
  await page.getByRole('button', { name: '저장소·백업', exact: true }).click();
  await page.getByRole('button', { name: '전체 백업 만들기', exact: true }).click();
  await expect(page.getByText('전체 백업 생성 완료', { exact: false })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('link', { name: '검증한 전체 백업 파일 저장' }).click();
  await (await downloaded).saveAs(file);
}
async function restoreFrom(page: Page, file: string) {
  await page.getByRole('button', { name: '저장소·백업', exact: true }).click();
  await page.getByLabel('전체 백업 파일 선택').setInputFiles(file);
  await expect(page.getByText('복원 미리보기: 2개 여행', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '확인 후 전체 복원', exact: true }).click();
  await expect(page.getByText('전체 복원 완료.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.reload();
}
async function emptyTarget(browser: Browser, page: Page, review: string) {
  const context = await browser.newContext({ viewport: page.viewportSize() ?? undefined, serviceWorkers: 'allow' });
  const target = await context.newPage();
  await target.route('**/api/ai/v2/status', (route) => route.fulfill({ json: { configured: false } }));
  await target.goto(`http://127.0.0.1:4173${space(review)}`);
  await expect(target.getByText('검증용 저장소', { exact: false })).toBeVisible();
  return { context, target };
}

test('두 여행(가져온 A·수동 B)을 전체 백업해 빈 검토 공간에 복원하면 행·첨부·화면·근거가 같다', async ({
  page,
  browser,
}) => {
  const source = `c06-src-${test.info().project.name}`;
  const destination = `c06-dst-${test.info().project.name}`;
  await page.goto(space(source));
  await buildA(page);
  await createB(page);
  await selectTrip(page, A_NAME);
  await reimportEvidence(page);

  // 복원 전 기준: 두 여행 행·첨부 바이트.
  const before = await dump(page, source);
  const aId = tripIdOf(before, A_NAME);
  const bId = tripIdOf(before, B_NAME);
  expect(before.tables.trip_headers).toHaveLength(2);
  // 비교가 빈 표를 비교하는 것이 되지 않도록 통합 상태의 최소 규모를 고정한다.
  const size = counts(before);
  expect(size.field_records).toBeGreaterThanOrEqual(5);
  expect(size.plan_versions).toBeGreaterThanOrEqual(6);
  expect(size.proposal_revisions).toBeGreaterThanOrEqual(4);
  expect(size.import_mappings).toBeGreaterThan(0);
  expect(size.command_receipts).toBeGreaterThan(15);
  expect(before.assets.length).toBeGreaterThanOrEqual(2);
  for (const asset of before.assets) {
    expect(asset).toMatchObject({ verified: true });
    expect(asset.actualSha256).toBe(asset.sha256);
    expect(asset.actualSize).toBe(asset.byteLength);
  }
  // 근거는 두 revision이며 적용 변경안은 이전 revision을 가리킨다.
  const evidenceRevisions = before.tables.content_revisions.filter(
    (r) => r.tripId === aId && r.kind === 'evidence' && r.entityId === 'evidence-1',
  );
  expect(evidenceRevisions).toHaveLength(2);
  expect(before.tables.import_heads.some((r) => r.tripId === aId)).toBe(true);
  expect(before.tables.import_heads.some((r) => r.tripId === bId)).toBe(false);
  expect(before.tables.import_packages.some((r) => r.tripId === bId)).toBe(false);

  // 근거 이동: 복원 전에도 같은 동작을 확인한다(복원 뒤 같은 검사와 짝).
  await selectTrip(page, A_NAME);
  await evidenceRoundTrip(page);

  const unitsBeforeBackup = await conflictReviewSnapshot(page, source);
  expect(unitsBeforeBackup.find((u) => u.heading.startsWith('plan / current-plan'))).toMatchObject({
    status: '양쪽 수정 충돌',
    choice: 'defer',
  });
  const file = test.info().outputPath('c06-full-backup.zip');
  await backupTo(page, file);
  await page.getByRole('button', { name: '닫기', exact: true }).click();

  const { context, target } = await emptyTarget(browser, page, destination);
  try {
    // 비어 있지 않은 공간에는 복원이 거부되고 기존 데이터는 그대로다(원본 공간에서 시도).
    await page.getByRole('button', { name: '저장소·백업', exact: true }).click();
    await expect(page.getByLabel('전체 백업 파일 선택')).toBeDisabled();
    const afterRejected = await dump(page, source);
    expect(domain(afterRejected)).toEqual(domain(before));
    await page.getByRole('button', { name: '닫기', exact: true }).click();

    // 빈 공간으로 복원.
    await restoreFrom(target, file);
    const restored = await dump(target, destination);
    // 복원된 공간도 비어 있지 않으므로 같은 백업을 다시 복원할 수 없다.
    await target.getByRole('button', { name: '저장소·백업', exact: true }).click();
    await expect(target.getByLabel('전체 백업 파일 선택')).toBeDisabled();
    await target.getByRole('button', { name: '닫기', exact: true }).click();
    expect(counts(restored)).toEqual(counts(before));
    expect(domain(restored)).toEqual(domain(before));
    // 의도된 차이: 새 spaceId 하나, 원본과 다른 값.
    expect(spaceIds(restored).size).toBe(1);
    expect([...spaceIds(restored)][0]).not.toEqual([...spaceIds(before)][0]);
    // 첨부: 이름/메타뿐 아니라 바이트·크기·해시.
    const key = (a: Dump['assets'][number]) => `${a.tripId}/${a.sha256}`;
    expect(restored.assets.map((a) => [key(a), a.byteLength, a.actualSha256, a.actualSize, a.verified]).sort()).toEqual(
      before.assets.map((a) => [key(a), a.byteLength, a.actualSha256, a.actualSize, a.verified]).sort(),
    );

    // 복원 후 화면: 이미지, 앱 전용 콘텐츠, 정정 체인, 회고, 근거 이동.
    await selectTrip(target, A_NAME);
    await readAppOnly(target);
    await evidenceRoundTrip(target);
    await selectTrip(target, B_NAME);
    await openRetro(target);
    const retro = target.getByRole('region', { name: '날짜별 회고' });
    await retro.getByLabel('회고 날짜').selectOption('unknown');
    await expect(retro.getByText('B 우연한 카페', { exact: false }).first()).toBeVisible();
    await expect(retro.getByText('A 앱 현장 기록')).toHaveCount(0);
    await selectTrip(target, A_NAME);
    await openRetro(target);
    await expect(target.getByRole('region', { name: '날짜별 회고' }).getByText('B 우연한 카페')).toHaveCount(0);

    // 복원한 공간에서 같은 재가져오기 검토를 반복하면 기준·선택 의미가 같다(적용 없이 닫음).
    await selectTrip(target, A_NAME);
    expect(await conflictReviewSnapshot(target, destination)).toEqual(unitsBeforeBackup);

    // 오프라인 재실행 뒤에도 같은 근거를 읽는다.
    await target.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await target.waitForTimeout(400);
    await context.setOffline(true);
    await target.reload();
    await selectTrip(target, A_NAME);
    await evidenceRoundTrip(target);
    await context.setOffline(false);

    // 조회만으로 행이 바뀌지 않는다. 그 뒤의 작은 편집은 정상 저장되며 최초 비교와 분리한다.
    const afterReading = await dump(target, destination);
    expect(domain(afterReading)).toEqual(domain(before));
    await selectTrip(target, B_NAME);
    await openExtra(target, '실제 기록');
    await recordUnplanned(target, '복원 뒤 기록', '복원 뒤 메모');
    const afterEdit = await dump(target, destination);
    expect(afterEdit.tables.field_records.length).toBe(before.tables.field_records.length + 1);
    expect(domain(afterEdit, aId)).toEqual(domain(before, aId));
  } finally {
    await context.close();
  }
});

test('가져온 여행 A의 앱 편집·현장 기록은 재가져오기 검토·선택 적용에서 보존되고 B는 변하지 않는다', async ({
  page,
}) => {
  const source = `c06-reimport-${test.info().project.name}`;
  await page.goto(space(source));
  await buildA(page);
  await createB(page);
  await selectTrip(page, A_NAME);
  await reimportEvidence(page);
  const base = await dump(page, source);
  const baseAppHeads = appOnlyHeads(base, tripIdOf(base, A_NAME));
  const aId = tripIdOf(base, A_NAME);
  const bId = tripIdOf(base, B_NAME);

  // 같은 패키지를 다시 검토해도 앱 전용 콘텐츠는 삭제 후보가 아니고, 검토 준비·닫기는 아무것도 쓰지 않는다.
  await openReview(page, await packageFile('evidence-source.zip', changeEvidence));
  const sameUnits = await reviewUnits(page);
  expect(sameUnits.map((u) => u.heading)).toEqual(['plan / current-plan / 전체']);
  expect(sameUnits[0]).toMatchObject({ status: '앱에서만 수정', choice: 'local' });
  expect(sameUnits.some((u) => /앱 전용/.test(u.heading))).toBe(false);
  await closeDialog(page);
  expect(domain(await dump(page, source))).toEqual(domain(base));

  // 새 원천이 앱이 고친 계획과 같은 항목을 바꾸면 충돌이다. 기본은 보류이고 보류하면 앱 편집이 남는다.
  await openReview(page, await packageFile('conflict-source.zip', changeEvidenceAndFirstActivity));
  const conflict = await reviewUnits(page);
  const planUnit = conflict.find((u) => u.heading.startsWith('plan / current-plan'));
  expect(planUnit).toMatchObject({ status: '양쪽 수정 충돌', choice: 'defer' });
  await page.getByRole('button', { name: '검토한 선택 적용', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await openTab(page, '오늘');
  await expect(page.getByText('앱에서 추가한 활동', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: '새 원천 활동 제목', exact: true })).toHaveCount(0);
  await readAppOnly(page);
  const afterDefer = await dump(page, source);
  // 보류는 계획·기록·콘텐츠 행을 바꾸지 않는다(가져오기 기록/영수증만 추가될 수 있음).
  for (const table of ['plan_versions', 'plan_items', 'field_records', 'content_revisions', 'content_heads'] as const) {
    expect(domain(afterDefer, aId)[table]).toEqual(domain(base, aId)[table]);
  }

  // 같은 검토를 다시 열면 기준이 보존돼 같은 의미(충돌·보류)로 나온다.
  await openReview(page, await packageFile('conflict-source.zip', changeEvidenceAndFirstActivity));
  expect((await reviewUnits(page)).find((u) => u.heading.startsWith('plan / current-plan'))).toMatchObject({
    status: '양쪽 수정 충돌',
    choice: 'defer',
  });

  // 명시적으로 새 원본을 선택하면 계획만 원천 값이 되고, 이전 계획·현장 기록·앱 전용 콘텐츠는 남는다.
  await page.getByLabel('반영 선택 current-plan 전체').selectOption('remote');
  await page.getByRole('button', { name: '검토한 선택 적용', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await openTab(page, '오늘');
  await expect(page.getByRole('heading', { name: '새 원천 활동 제목', exact: true })).toBeVisible();
  const afterRemote = await dump(page, source);
  const planCount = (d: Dump) => d.tables.plan_versions.filter((p) => p.tripId === aId).length;
  expect(planCount(afterRemote)).toBe(planCount(base) + 1);
  // 앱에서 만든 지역·장소는 원천에 없다는 이유로 삭제·비활성화·교체되지 않는다.
  expect(appOnlyHeads(afterRemote, aId)).toEqual(baseAppHeads);
  expect(appOnlyHeads(afterDefer, aId)).toEqual(baseAppHeads);
  // 이전 계획 버전과 현장 기록 행은 그대로 보존된다.
  for (const table of ['field_records'] as const) {
    expect(domain(afterRemote, aId)[table]).toEqual(domain(base, aId)[table]);
  }
  for (const row of domain(base, aId).plan_versions) {
    expect(domain(afterRemote, aId).plan_versions).toContain(row);
  }
  await openTab(page, '가이드');
  await expect(page.getByRole('button', { name: '앱 전용 장소', exact: true })).toBeVisible();

  // 과거(앱 편집 시점) 계획과 그 근거는 그대로 읽힌다.
  await evidenceRoundTrip(page);

  // 별도 여행 B는 A의 검토·적용 전후 어떤 행도 바뀌지 않았다.
  expect(domain(afterRemote, bId)).toEqual(domain(base, bId));
  await selectTrip(page, B_NAME);
  await openRetro(page);
  await page.getByRole('region', { name: '날짜별 회고' }).getByLabel('회고 날짜').selectOption('unknown');
  await expect(
    page.getByRole('region', { name: '날짜별 회고' }).getByText('B 우연한 카페', { exact: false }).first(),
  ).toBeVisible();
});

test('회고에서 적용 당시 고정 근거 본문을 열고 같은 날짜·버전으로 돌아오며 조회는 아무것도 바꾸지 않는다', async ({
  page,
  context,
}) => {
  const source = `c06-evidence-${test.info().project.name}`;
  await page.goto(space(source));
  await buildA(page);
  await reimportEvidence(page);
  const before = await dump(page, source);

  await evidenceRoundTrip(page);

  // 근거는 두 revision이며 최신 head는 새 본문, 적용 당시 revision은 이전 본문이다.
  const evidenceHeads = before.tables.content_heads.filter(
    (h) => h.targetKind === 'evidence' && h.entityId === 'evidence-1',
  );
  expect(evidenceHeads).toHaveLength(1);
  const claims = before.tables.content_revisions
    .filter((r) => r.kind === 'evidence' && r.entityId === 'evidence-1')
    .map((r) => (r.payload as { claim?: string }).claim)
    .sort();
  expect(claims).toEqual([EVIDENCE_NOW, EVIDENCE_THEN].sort());

  // 재실행·오프라인 뒤에도 같은 근거를 읽고 조회 전후 행이 같다.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForTimeout(400);
  await context.setOffline(true);
  await page.reload();
  await evidenceRoundTrip(page);
  await context.setOffline(false);
  expect(domain(await dump(page, source))).toEqual(domain(before));
});
