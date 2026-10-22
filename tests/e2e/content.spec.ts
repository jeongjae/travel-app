import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { buildPackage } from '../../src/transfer/package';
import { pilotTrip, fixtureAssets } from '../fixtures/pilot';
import { digestBytes } from '../../src/contracts/v2';
let browserErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  browserErrors = [];
  page.on('pageerror', (e) => browserErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') browserErrors.push(m.text());
  });
});
test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) {
    expect(browserErrors).toEqual([]);
    expect(await page.locator('vite-error-overlay').count()).toBe(0);
    expect(await page.locator('body').evaluate((e) => e.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
async function seed(page: Page, short = false) {
  await page.goto('/?workspace=content');
  await page.getByRole('button', { name: '가상 여행 둘러보기', exact: true }).click();
  await page
    .getByRole('button', { name: short ? '가상 미술 여행 B · 1일' : '가상 산책 여행 A · 3일', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '여행에 추가', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(
    page.getByRole('heading', { name: short ? '가상 미술 여행 B' : '가상 산책 여행 A', exact: true, level: 1 }),
  ).toBeVisible();
}
async function guide(page: Page, name = '가상 장소 1') {
  await page.getByRole('button', { name: '장소·지역', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('heading', { name: '실용', exact: true })).toBeVisible();
}
test('전체 ZIP 백업 파일 저장→빈 브라우저에서 오프라인 미리보기·복원·재시작', async ({ page, browser }) => {
  await seed(page);
  await seed(page, true);
  await page.getByRole('button', { name: '저장소·백업', exact: true }).click();
  await expect(page.getByLabel('전체 백업 파일 선택')).toBeDisabled();
  await page.getByRole('button', { name: '전체 백업 만들기', exact: true }).click();
  await expect(page.getByText('전체 백업 생성 완료', { exact: false })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('link', { name: '검증한 전체 백업 파일 저장' }).click();
  const file = await downloaded,
    path = test.info().outputPath('synthetic-full-backup.zip');
  await file.saveAs(path);
  const target = await browser.newContext({ viewport: page.viewportSize() ?? undefined, serviceWorkers: 'allow' }),
    restored = await target.newPage();
  const errors: string[] = [];
  restored.on('pageerror', (e) => errors.push(e.message));
  try {
    await restored.goto('http://127.0.0.1:4173/?workspace=content');
    await restored.getByRole('button', { name: '저장소·백업', exact: true }).click();
    await expect(restored.getByRole('heading', { name: '빈 저장소 전체 복원' })).toBeVisible();
    await restored.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await restored.waitForTimeout(400);
    await target.setOffline(true);
    await restored.reload();
    await restored.getByRole('button', { name: '저장소·백업', exact: true }).click();
    await restored.getByLabel('전체 백업 파일 선택').setInputFiles(path);
    await expect(restored.getByText('복원 미리보기: 2개 여행', { exact: false })).toBeVisible();
    await expect(restored.getByRole('navigation', { name: '여행 선택' }).getByRole('button')).toHaveCount(0);
    await restored.getByRole('button', { name: '확인 후 전체 복원', exact: true }).click();
    await expect(restored.getByText('전체 복원 완료.', { exact: false })).toBeVisible();
    await restored.getByRole('button', { name: '닫기', exact: true }).click();
    await restored.reload();
    await expect(restored.getByRole('navigation', { name: '여행 선택' }).getByRole('button')).toHaveCount(2);
    await guide(restored);
    await expect(restored.getByRole('img', { name: '표본' })).toBeVisible();
    expect(errors).toEqual([]);
    expect(await restored.locator('body').evaluate((e) => e.scrollWidth <= window.innerWidth)).toBe(true);
    await restored.getByRole('button', { name: '저장소·백업', exact: true }).click();
    await expect(restored.getByText('오프라인 준비됨', { exact: false })).toHaveCount(2);
    await restored.screenshot({ path: test.info().outputPath('p06-restored.png'), fullPage: false });
  } finally {
    await target.close();
  }
});
test('오프라인 첨부 축출 안내→현장 기록 유지→불완전 백업 차단→파일로 바이트 복구', async ({ page, context }) => {
  await seed(page);
  await page.getByRole('button', { name: '저장소·백업', exact: true }).click();
  await expect(page.getByText('오프라인 준비됨', { exact: false })).toHaveCount(2);
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open('travel-app');
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const db = r.result,
          tx = db.transaction('asset_blobs', 'readwrite'),
          store = tx.objectStore('asset_blobs'),
          cursor = store.openCursor();
        cursor.onsuccess = () => cursor.result?.delete();
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
    await navigator.serviceWorker.ready;
  });
  await page.waitForTimeout(400);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: '예정 외 활동 기록', exact: true }).click();
  await page.getByLabel('활동 이름').fill('첨부 없이 남긴 현장 기록');
  await page.getByRole('button', { name: '실제 기록 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: '저장소·백업', exact: true }).click();
  await expect(page.getByText('누락 또는 손상 · 복구 필요', { exact: false })).toHaveCount(1);
  await page.getByRole('button', { name: '전체 백업 만들기', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('첨부 바이트가 누락');
  await expect(page.getByRole('link', { name: '검증한 전체 백업 파일 저장' })).toHaveCount(0);
  await page.getByLabel('첨부 복구용 패키지·백업 선택').setInputFiles(resolve('public/pilot/fixture-a.zip'));
  await expect(page.getByText('2개 첨부를 복구했습니다.', { exact: false })).toBeVisible();
  await expect(page.getByText('오프라인 준비됨', { exact: false })).toHaveCount(2);
  await page.getByRole('button', { name: '전체 백업 만들기', exact: true }).click();
  await expect(page.getByText('전체 백업 생성 완료', { exact: false })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('p06-assets-repaired.png'), fullPage: false });
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: '실제 기록', exact: true }).click();
  await expect(page.getByRole('heading', { name: '첨부 없이 남긴 현장 기록', exact: true })).toBeVisible();
});
test('가이드 패키지→동일 프로그램 두 여행·본문·Fact·표·첨부·과거 내용', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await seed(page);
  await guide(page);
  await expect(page.locator('table')).toBeVisible();
  await expect(page.getByText('가상 원문: 오후 개방', { exact: false })).toBeVisible();
  await expect(page.getByRole('img', { name: '표본' })).toBeVisible();
  await page.getByRole('button', { name: '실용 편집', exact: true }).click();
  await page.getByLabel('본문 Markdown').fill('A에서 편집한 안내 {{fact:opening}}');
  await page.getByRole('button', { name: '본문 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.reload();
  await guide(page);
  await expect(page.getByText('A에서 편집한 안내', { exact: false })).toBeVisible();
  await page.getByLabel('계획 버전').selectOption('plan-1');
  await page.getByRole('button', { name: '가상 장소 1', exact: true }).click();
  await expect(page.getByText('당시 고정 내용', { exact: false })).toBeVisible();
  await expect(page.getByText('A에서 편집한 안내', { exact: false })).not.toBeVisible();
  await page.getByLabel('계획 버전').selectOption('');
  await page.getByRole('button', { name: '가상 여행 둘러보기', exact: true }).click();
  await page.getByRole('button', { name: '가상 미술 여행 B · 1일', exact: true }).click();
  await page.getByRole('button', { name: '여행에 추가', exact: true }).click();
  await guide(page, '가상 전시관 B');
  await expect(page.getByText('운영시간 미확인 B', { exact: false })).toBeVisible();
  await expect(page.getByText('A에서 편집한 안내', { exact: false })).not.toBeVisible();
  expect(await page.locator('body').evaluate((e) => e.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('content-guide.png'), fullPage: true });
});
test('오프라인 미상 기록·계획 제거·정정과 모의 변경안 확인 적용', async ({ page, context }) => {
  await seed(page);
  await page.getByRole('button', { name: '건너뜀 기록', exact: true }).first().click();
  await page.getByLabel('기록 메모').fill('가상 비 때문에 건너뜀');
  await page.getByRole('button', { name: '실제 기록 저장', exact: true }).click();
  await page.getByRole('button', { name: '일정에서 제거', exact: true }).first().click();
  await page.getByRole('button', { name: '실제 기록', exact: true }).click();
  await expect(page.getByText('가상 비 때문에 건너뜀', { exact: true })).toBeVisible();
  await expect(page.getByText('시각 미정', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: '정정', exact: true }).last().click();
  await page.getByLabel('기록 메모').fill('가상 기록 정정');
  await page.getByRole('button', { name: '실제 기록 저장', exact: true }).click();
  await expect(page.getByText('정정된 기록 · 원본 보존')).toBeVisible();
  await page.getByRole('button', { name: '변경안', exact: true }).click();
  await expect(page.getByText('기준이 오래됐습니다.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '모의 변경안 만들기', exact: true }).click();
  await page.getByLabel('변경할 활동 이름').fill('확인한 새 산책');
  await page.getByRole('button', { name: '미적용 초안 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '변경안', exact: true }).click();
  await page.getByRole('button', { name: '확인 후 적용', exact: true, disabled: false }).click();
  await page.getByRole('button', { name: '일정', exact: true }).click();
  await expect(page.getByRole('heading', { name: '확인한 새 산책' })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForTimeout(400);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: '실제 기록', exact: true }).click();
  await expect(page.getByText('가상 기록 정정', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '예정 외 활동 기록', exact: true }).click();
  await page.getByLabel('활동 이름').fill('오프라인 예정 외');
  await page.getByRole('button', { name: '실제 기록 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '실제 기록', exact: true }).click();
  await expect(page.getByRole('heading', { name: '오프라인 예정 외', exact: true })).toBeVisible();
});
test('다른 탭의 편집 뒤 오래된 본문 폼은 입력을 보존하고 충돌을 표시한다', async ({ page, context }) => {
  await seed(page);
  await guide(page);
  await page.getByRole('button', { name: '실용 편집', exact: true }).click();
  await page.getByLabel('본문 Markdown').fill('보존할 오래된 입력');
  const other = await context.newPage();
  await other.goto('/?workspace=content');
  await guide(other);
  await other.getByRole('button', { name: '실용 편집', exact: true }).click();
  await other.getByLabel('본문 Markdown').fill('다른 탭의 본문');
  await other.getByRole('button', { name: '본문 저장', exact: true }).click();
  await page.getByRole('button', { name: '본문 저장', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('CONFLICT');
  await expect(page.getByLabel('본문 Markdown')).toHaveValue('보존할 오래된 입력');
  await other.close();
});
test('새 원본과 앱 본문의 충돌을 검토하고 선택한 섹션만 반영한다', async ({ page }) => {
  await seed(page);
  await guide(page);
  await page.getByRole('button', { name: '실용 편집', exact: true }).click();
  await page.getByLabel('본문 Markdown').fill('앱 실용 유지');
  await page.getByRole('button', { name: '본문 저장', exact: true }).click();
  const t = await pilotTrip(),
    g = t.contents.find((c) => c.kind === 'guide')!;
  if (g.kind !== 'guide') throw new Error();
  g.payload.sections.find((s) => s.key === 'practical')!.bodyMd = '새 원본 실용';
  g.payload.sections.find((s) => s.key === 'why_go')!.bodyMd = '새 원본 소개';
  const assets = new Map<string, Uint8Array>();
  for (const b of Object.values(fixtureAssets)) assets.set(await digestBytes(b), b);
  const p = await buildPackage(t, assets, {
    sourceRepository: 'synthetic/pilot',
    sourceCommit: 'synthetic-v2',
    lineageId: 'synthetic-pilot',
    adapterVersion: '1',
    normalizationVersion: 'pilot-v1',
  });
  await page.getByLabel('여행 패키지 선택').setInputFiles({
    name: 'new-source.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(await p.blob.arrayBuffer()),
  });
  await page.getByRole('button', { name: '재가져오기 차이 검토', exact: true }).click();
  await expect(page.getByRole('heading', { name: '재가져오기 차이 검토', exact: true })).toBeVisible();
  await expect(page.getByText('양쪽 수정 충돌', { exact: true })).toBeVisible();
  await page.getByLabel('반영 선택 guide-place sections/practical').selectOption('local');
  await page.getByRole('button', { name: '검토한 선택 적용', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await guide(page);
  await expect(page.getByText('앱 실용 유지', { exact: true })).toBeVisible();
  await expect(page.getByText('새 원본 소개', { exact: true })).toBeVisible();
});
test('예약·작업 체크·메모·계획 수정과 새 여행을 공통 화면에서 저장한다', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: '예약·할 일', exact: true }).click();
  await page.getByRole('button', { name: '예약 상태 수정', exact: true }).click();
  await page.getByLabel('새 예약 상태').fill('사용자 확인');
  await page.getByRole('button', { name: '예약 상태 저장', exact: true }).click();
  await expect(page.getByText('상태: 사용자 확인', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '작업 완료', exact: true }).click();
  await expect(page.getByRole('button', { name: '완료 취소', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await page.getByRole('button', { name: '예약·할 일', exact: true }).click();
  await expect(page.getByRole('button', { name: '완료 취소', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '실제 기록', exact: true }).click();
  await page.getByRole('button', { name: '여행 메모 쓰기', exact: true }).click();
  await page.getByLabel('메모 본문').fill('현장에서 남긴 가상 메모');
  await page.getByRole('button', { name: '메모 저장', exact: true }).click();
  await expect(page.getByText('현장에서 남긴 가상 메모', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '일정', exact: true }).click();
  await page.getByRole('button', { name: '일정 수정', exact: true }).first().click();
  await page.getByLabel('활동 제목').fill('직접 수정한 가상 활동');
  await page.getByRole('button', { name: '계획 저장', exact: true }).click();
  await expect(page.getByRole('heading', { name: '직접 수정한 가상 활동', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '새 여행', exact: true }).click();
  await page.getByLabel('여행 이름').fill('새로운 짧은 여행');
  await page.getByLabel('시작 날짜').fill('2032-04-01');
  await page.getByLabel('종료 날짜').fill('2032-04-02');
  await page.getByRole('button', { name: '여행 만들기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '새로운 짧은 여행', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '활동 추가', exact: true }).click();
  await page.getByLabel('활동 제목').fill('새 여행 첫 활동');
  await page.getByRole('button', { name: '계획 저장', exact: true }).click();
  await expect(page.getByRole('heading', { name: '새 여행 첫 활동', exact: true })).toBeVisible();
});
test('기존 여행을 검토한 뒤 전환하고 이전 실제 기록을 공통 화면에서 조회한다', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '예시 여행 불러오기', exact: true }).click();
  await page.getByRole('button', { name: '건너뜀', exact: true }).first().click();
  await page.getByLabel('메모', { exact: true }).fill('이전 화면에서 남긴 기록');
  await page.getByRole('button', { name: '실제 기록 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.goto('/?workspace=content');
  await page.getByRole('button', { name: '기존 여행 전환 검토', exact: true }).click();
  await expect(page.getByRole('heading', { name: '기존 여행 전환 확인', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '원문 보존 후 전환', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: '파리의 느린 주말', exact: true }).click();
  await page.getByRole('button', { name: '실제 기록', exact: true }).click();
  await expect(page.getByText('이전 화면에서 남긴 기록', { exact: true })).toBeVisible();
});
