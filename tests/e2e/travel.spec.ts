import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { Trip, ProposalInput } from '../../src/domain';

test.beforeEach(async ({page}) => {
  await page.route('**/api/ai/status',route=>route.fulfill({json:{configured:false,model:'test-only'}}));
});

async function seed(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '예시 여행 불러오기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '파리의 느린 주말', exact: true })).toBeVisible();
}
async function fileImport(page: Page, data: unknown) {
  await page.getByLabel('JSON 파일 선택').setInputFiles({ name: 'test.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await expect(page.getByRole('dialog')).toBeVisible();
}
async function exportedTrip(page: Page): Promise<Trip> {
  await page.getByRole('button', { name: '여행 설정', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '여행 JSON 다운로드' }).click();
  const path = await (await download).path();
  return JSON.parse(await readFile(path!, 'utf8')).trip;
}
function proposal(trip: Trip): ProposalInput {
  const a = trip.versions.at(-1)!.activities[0];
  return { id: `test-proposal-${trip.revision}`, tripId: trip.id, baseRevision: trip.revision, reason: '가상 근거를 검토한 일정 변경', reservationImpact: '예약 영향 없음',
    evidence: [{ id: 'source-1', source: 'https://example.org/travel', claim: '브라우저 테스트용 가상 근거', checkedAt: '2026-10-21T00:00:00Z', appliesFrom: trip.startDate, appliesTo: trip.endDate, relatedActivityIds: [a.id], status: 'unverified' }],
    operations: [{ type: 'upsert', activity: { ...a, title: '동네 도서관에서 아침' } }],
  };
}
test('일정 변경 뒤 실제 기록 보존, 정정 이력, 두 여행 격리와 재실행', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await seed(page);
  await expect(page).toHaveTitle('travel-app · 여행 계획과 기록');
  expect(await page.locator('body').evaluate(e => e.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: '건너뜀', exact: true }).nth(1).click();
  await page.getByLabel('메모', { exact: true }).fill('비가 와서 산책을 건너뜀');
  await page.getByRole('button', { name: '실제 기록 저장' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: '실제 기록', exact: true }).click();
  await expect(page.getByText('비가 와서 산책을 건너뜀', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '예정 외 기록' }).click();
  await page.getByLabel('활동 이름').fill('계획에 없던 책방');
  await page.getByLabel('실제 시작').fill('2026-11-07T13:00'); await page.getByLabel('실제 종료').fill('2026-11-07T14:00');
  await page.getByLabel('메모', { exact: true }).fill('잠시 쉬어 가기');
  await page.getByRole('button', { name: '실제 기록 저장' }).click();
  await expect(page.getByRole('heading', { name: '계획에 없던 책방' })).toBeVisible();
  await page.getByRole('button', { name: '정정', exact: true }).nth(1).click();
  await page.getByLabel('실행 결과', { exact: true }).selectOption('visited');
  await page.getByLabel('메모', { exact: true }).fill('좋아하는 책을 발견함');
  await page.getByRole('button', { name: '실제 기록 저장' }).click();
  await expect(page.getByText('정정된 기록 · 원본 보존')).toBeVisible();
  await page.getByRole('button', { name: '일정', exact: true }).click();
  await page.getByRole('button', { name: '강변 산책', exact: true }).click();
  await page.getByLabel('활동 이름').fill('비 오는 날 도서관');
  await page.getByRole('button', { name: '일정 저장' }).click();
  await expect(page.getByRole('button', { name: '비 오는 날 도서관', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '비 오는 날 도서관', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '실제 기록', exact: true }).click();
  await expect(page.getByRole('heading', { name: '강변 산책', exact: true })).toBeVisible();
  await expect(page.getByText('좋아하는 책을 발견함', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '서울 산책', exact: true }).click();
  await page.getByRole('button', { name: '실제 기록', exact: true }).click();
  await expect(page.getByText('아직 남긴 기록이 없어요')).toBeVisible();
  await expect(page.getByRole('heading', { name: '강변 산책', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('변경안 미리보기·근거·승인 적용과 오래된 변경안의 충돌', async ({ page }) => {
  await seed(page);
  const trip = await exportedTrip(page); const p = proposal(trip);
  await fileImport(page, { format: 'travel-app-proposal', schemaVersion: 1, proposal: p });
  await page.getByRole('button', { name: '확인하고 가져오기' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: '일정', exact: true }).click();
  await expect(page.getByRole('button', { name: '동네 카페에서 아침', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '변경안', exact: true }).click();
  await expect(page.getByText('미확인 근거')).toBeVisible();
  await expect(page.getByText(/이전: 동네 카페에서 아침/)).toBeVisible();
  await page.getByRole('button', { name: '확인하고 적용' }).click();
  await expect(page.getByText('적용됨', { exact: true })).toBeVisible();
  await expect(page.getByText(/이전: 동네 카페에서 아침/)).toBeVisible();
  await page.getByRole('button', { name: '일정', exact: true }).click();
  await expect(page.getByRole('button', { name: '동네 도서관에서 아침', exact: true })).toBeVisible();
  await page.getByLabel('계획 버전', { exact: true }).selectOption('1');
  await expect(page.getByRole('button', { name: '동네 카페에서 아침', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '일정 추가', exact: true })).toBeDisabled();
  await page.getByLabel('계획 버전', { exact: true }).selectOption('current');
  const latest = await exportedTrip(page); const stale = { ...proposal(latest), id: 'stale' };
  await fileImport(page, { format: 'travel-app-proposal', schemaVersion: 1, proposal: stale });
  await page.getByRole('button', { name: '확인하고 가져오기' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: '일정', exact: true }).click();
  await page.getByRole('button', { name: '건너뜀', exact: true }).first().click();
  await page.getByRole('button', { name: '실제 기록 저장' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: '변경안', exact: true }).click();
  await expect(page.getByText(/충돌 · 변경안 작성 뒤/)).toBeVisible();
  await expect(page.getByRole('button', { name: '확인하고 적용' })).toBeDisabled();
});

test('다른 탭의 수정 뒤 열려 있던 편집 폼을 적용하면 충돌을 표시한다', async ({ page, context }) => {
  await seed(page);
  await page.getByRole('button', { name: '강변 산책', exact: true }).click();
  await page.getByLabel('활동 이름').fill('오래된 폼의 수정');
  const other = await context.newPage(); await other.goto('/');
  await other.getByRole('button', { name: '강변 산책', exact: true }).click();
  await other.getByLabel('활동 이름').fill('다른 탭에서 저장한 산책');
  await other.getByRole('button', { name: '일정 저장' }).click();
  await expect(other.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: '일정 저장' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('충돌');
  await page.getByRole('dialog').getByRole('button', { name: '닫기', exact: true }).click();
  await expect(page.getByRole('button', { name: '다른 탭에서 저장한 산책', exact: true })).toBeVisible();
});

test('프로덕션 PWA를 오프라인 재실행하고 현장 기록을 보존한다', async ({ page, context }) => {
  await seed(page);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: '파리의 느린 주말', exact: true })).toBeVisible();
  await expect(page.getByText('오프라인 · 이 기기에 계속 저장됩니다.')).toBeVisible();
  await page.getByRole('button', { name: '건너뜀', exact: true }).first().click();
  await page.getByLabel('메모', { exact: true }).fill('오프라인에서 저장');
  await page.getByRole('button', { name: '실제 기록 저장' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '실제 기록', exact: true }).click();
  await expect(page.getByText('오프라인에서 저장', { exact: true })).toBeVisible();
  await context.setOffline(false); await page.reload();
  await page.getByRole('button', { name: '실제 기록', exact: true }).click();
  await expect(page.getByText('오프라인에서 저장', { exact: true })).toBeVisible();
});

test('새 여행 검증 오류를 폼에 표시하고 전체 백업을 빈 브라우저에 복원한다', async ({ page, browser }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '첫 여행 만들기' }).click();
  await page.getByLabel('여행 이름').fill('교토의 주말');
  await page.getByLabel('시작일', { exact: true }).fill('2026-11-14'); await page.getByLabel('종료일', { exact: true }).fill('2026-11-13');
  await page.getByRole('button', { name: '여행 만들기', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('종료일');
  await page.getByLabel('종료일', { exact: true }).fill('2026-11-15'); await page.getByLabel('기본 시간대', { exact: true }).fill('Asia/Tokyo');
  await page.getByRole('button', { name: '여행 만들기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '교토의 주말' })).toBeVisible();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '백업', exact: true }).click();
  const backup = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  const fresh = await browser.newContext();
  try {
    const restored = await fresh.newPage(); await restored.goto('http://127.0.0.1:4173');
    await fileImport(restored, backup); await restored.getByRole('button', { name: '확인하고 복원' }).click();
    await expect(restored.getByRole('heading', { name: '교토의 주말' })).toBeVisible();
    await restored.reload(); await expect(restored.getByRole('heading', { name: '교토의 주말' })).toBeVisible();
  } finally { await fresh.close(); }
});

test('SP-FR 구조의 가상 일일카드를 미리보기 뒤 가져온다', async ({ page }) => {
  await page.goto('/');
  const legacy = { format: 'spfr-daily-cards', name: '가상 제주 여행', timeZone: 'Asia/Seoul', days: [{ schemaVersion: '1.0', day: 1, date: '2026-11-20', city: 'Jeju', title: '첫날', stops: [{ id: 'walk', start: '23:30', end: '00:30', name: '자정을 넘는 산책', summary: '가상 데이터' }] }] };
  await fileImport(page, legacy);
  await expect(page.getByRole('dialog')).toContainText('가상 제주 여행');
  await page.getByRole('button', { name: '확인하고 가져오기' }).click();
  await expect(page.getByRole('heading', { name: '가상 제주 여행', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '자정을 넘는 산책', exact: true })).toBeVisible();
  await expect(page.getByText('2026-11-21 종료')).toBeVisible();
  await page.getByRole('button', { name: '실제 기록', exact: true }).click();
  await expect(page.getByText('아직 남긴 기록이 없어요')).toBeVisible();
});

test('앱 내부 AI 결과가 자동으로 초안 저장되고 재로드 뒤에도 승인 전 계획을 유지한다', async ({ page }) => {
  let storedJob: Record<string, unknown> | undefined; let requests = 0;
  await page.route('**/api/ai/**', async route => {
    const request = route.request();
    if (request.url().endsWith('/status')) { await route.fulfill({ json: { configured: true, model: 'test-model' } }); return; }
    if (request.method() === 'POST' && request.url().endsWith('/jobs')) {
      requests++; const input = request.postDataJSON();
      storedJob = { id: input.id, tripId: input.trip.id, baseRevision: input.trip.revision, status: 'awaiting-decision', attempt: 1, model: 'test-model', sources: [{ url: 'https://example.org/travel', title: '가상 테스트 근거' }], proposal: { ...proposal(input.trip), id: `ai-${input.id}` } };
      await route.fulfill({ status: 202, json: storedJob }); return;
    }
    await route.fulfill({ status: storedJob ? 200 : 404, json: storedJob ?? { error: 'AI 작업이 없습니다.' } });
  });
  await seed(page);
  await page.getByRole('button', { name: '변경안', exact: true }).click();
  await page.getByLabel('AI에게 요청할 내용').fill('가상 자료를 조사해 카페 일정을 도서관으로 바꿔 주세요.');
  await page.getByRole('button', { name: '조사하고 변경안 만들기' }).click();
  await expect(page.getByText('변경안 저장됨 · 사용자 확인 대기', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '동네 카페에서 아침', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '변경안', exact: true }).click();
  await expect(page.getByText('변경안 저장됨 · 사용자 확인 대기', { exact: true })).toBeVisible();
  expect(requests).toBe(1);
  await page.getByRole('button', { name: '확인하고 적용' }).click();
  await expect(page.getByText('사용자 확인 후 적용됨', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '일정', exact: true }).click();
  await expect(page.getByRole('button', { name: '동네 도서관에서 아침', exact: true })).toBeVisible();
});
