import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { openStorage, openTripMenu } from './helpers/nav';

/**
 * C-11〔REG-03〕 복원 경로 안내. 가상 여행·가상 백업만 쓴다(사용자 백업 파일은 쓰지 않는다).
 * 복원 로직(빈 공간 조건)은 바뀌지 않았고, 조건·입력 종류를 화면이 설명하는지만 확인한다.
 */
const space = (name: string) => `/?workspace=content&review=${name}-${test.info().project.name}`;

async function createTrip(page: Page, name: string, year = '2032') {
  await openTripMenu(page);
  await page.getByRole('button', { name: '새 여행', exact: true }).click();
  await page.getByLabel('여행 이름').fill(name);
  await page.getByLabel('시작 날짜').fill(`${year}-06-01`);
  await page.getByLabel('종료 날짜').fill(`${year}-06-03`);
  await page.getByLabel('시간대', { exact: false }).fill('Asia/Tokyo');
  await page.getByRole('button', { name: '여행 만들기', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible();
}

async function saveBackup(page: Page) {
  await page.getByRole('button', { name: '전체 백업 만들기', exact: true }).click();
  await expect(page.getByText('전체 백업 생성 완료', { exact: false })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('link', { name: '검증한 전체 백업 파일 저장' }).click();
  const path = test.info().outputPath('c11-virtual-backup.zip');
  await (await downloaded).saveAs(path);
  return path;
}

test('여행이 있는 공간은 복원이 비활성이고 이유와 새 빈 공간 열기가 보이며, 새 탭의 빈 공간에서 복원된다', async ({
  page,
  context,
}) => {
  await page.goto(space('c11-a'));
  await createTrip(page, '가상 복원 안내 여행');
  await openStorage(page);
  const backupPath = await saveBackup(page);

  await expect(page.getByLabel('전체 백업 복원')).toBeDisabled();
  await expect(page.getByText('이 공간에 여행 1개가 있어 전체 복원을 할 수 없습니다.', { exact: false })).toBeVisible();
  await expect(page.getByText('전체 복원은 빈 공간에서만 합니다.', { exact: false })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('c11-disabled-reason.png') });

  const popupPromise = context.waitForEvent('page');
  await page.getByRole('button', { name: '새 빈 공간 열기', exact: true }).click();
  const restored = await popupPromise;
  await restored.waitForLoadState();
  expect(new URL(restored.url()).searchParams.get('review')).toMatch(/^restore-\d{8}-\d+$/);
  // 현재 공간은 그대로다.
  await expect(page.getByLabel('전체 백업 복원')).toBeDisabled();

  await openStorage(restored);
  await expect(restored.getByText('여행 1개가 있어', { exact: false })).toHaveCount(0);
  await restored.screenshot({ path: test.info().outputPath('c11-new-empty-space.png') });
  await restored.getByLabel('전체 백업 복원').setInputFiles(backupPath);
  await expect(restored.getByText('복원 미리보기: 1개 여행', { exact: false })).toBeVisible();
  await restored.getByRole('button', { name: '확인 후 전체 복원', exact: true }).click();
  await expect(restored.getByText('복원한 여행은 이 공간(restore-', { exact: false })).toBeVisible();
  await expect(restored.getByText('여행 메뉴에서 전환해 쓰세요.', { exact: false })).toBeVisible();
  await restored.getByRole('button', { name: '닫기', exact: true }).click();
  await restored.reload();
  await expect(restored.getByRole('heading', { level: 1, name: '가상 복원 안내 여행', exact: true })).toBeVisible();
});

test('백업 ZIP을 원천 패키지 입력에, 원천 패키지를 백업 복원 입력에 넣으면 안내 문구가 입력 아래에 보인다', async ({
  page,
}) => {
  await page.goto(space('c11-b'));
  await createTrip(page, '가상 입력 구분 여행');
  await openStorage(page);
  const backupPath = await saveBackup(page);
  await page.getByRole('button', { name: '닫기', exact: true }).click();

  await openTripMenu(page);
  await page.getByLabel('원천 패키지 가져오기').setInputFiles(backupPath);
  const wrongInput = page.getByRole('alert');
  await expect(wrongInput).toContainText('전체 백업 파일입니다.');
  await expect(wrongInput).toContainText('전체 백업 복원');
  await expect(wrongInput).not.toContainText('이행 패키지 v2');
  await page.screenshot({ path: test.info().outputPath('c11-wrong-file-package-input.png') });

  // 반대 방향은 여행이 없는 공간에서만 복원 입력이 켜진다.
  await page.goto(space('c11-c'));
  await openStorage(page);
  await page.getByLabel('전체 백업 복원').setInputFiles(resolve('public/pilot/fixture-a.zip'));
  await expect(page.getByRole('alert')).toContainText('원천 패키지입니다.');
  await expect(page.getByRole('alert')).toContainText('원천 패키지 가져오기');
  await page.screenshot({ path: test.info().outputPath('c11-wrong-file-restore-input.png') });
});

test('첨부 복구 입력은 여행 수를 바꾸지 않는다', async ({ page }) => {
  await page.goto(space('c11-d'));
  await createTrip(page, '가상 첨부 복구 여행');
  await openStorage(page);
  const backupPath = await saveBackup(page);
  await page.getByLabel('첨부 사진만 복구').setInputFiles(backupPath);
  // 첨부 바이트가 없는 가상 여행이므로 여행·계획을 가져오지 않고 안내만 보인다.
  await expect(page.getByRole('alert')).toContainText('일치하는 파일이 없습니다');
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await openTripMenu(page);
  await expect(page.getByRole('navigation', { name: '여행 선택' }).getByRole('button')).toHaveCount(1);
});

test('종료된 여행의 오늘 화면에서 회고 보기로 들어가고 기록 탭에서도 회고 버튼이 기본 버튼이다', async ({ page }) => {
  await page.goto(space('c11-e'));
  await createTrip(page, '가상 종료 여행', '2020');
  // 종료일(2020-06-03)이 지난 여행이다. 아직 오지 않은 날짜의 여행에는 링크가 없다.
  await page.getByRole('button', { name: '회고 보기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '날짜별 회고', exact: true })).toBeVisible();
  const nav = page.getByRole('navigation', { name: '주요 메뉴' });
  await nav.getByRole('button', { name: '오늘', exact: true }).click();
  await nav.getByRole('button', { name: '기록', exact: true }).click();
  await expect(page.getByRole('button', { name: '날짜별 회고 보기', exact: true })).toHaveClass(/primary/);
});
