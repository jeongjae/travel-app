import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 전체 E2E를 CI와 같은 4묶음으로 순서대로 돌린다(PC 메모리를 한 번에 많이 쓰지 않도록 동시 실행하지 않는다).
 * 한 묶음이 실패해도 나머지를 계속 돌리고, 마지막에 묶음별 결과를 모아 보여 준 뒤 실패가 있으면 실패로 끝난다.
 * 미리보기가 `dist`를 쓰므로 먼저 빌드한다. 묶음 정의는 `.github/workflows/checks.yml`과 같아야 한다.
 */
const GROUPS = [
  { name: 'chromium 1/3', args: ['--project=desktop', '--project=mobile', '--shard=1/3'] },
  { name: 'chromium 2/3', args: ['--project=desktop', '--project=mobile', '--shard=2/3'] },
  { name: 'chromium 3/3', args: ['--project=desktop', '--project=mobile', '--shard=3/3'] },
  { name: 'webkit', args: ['--project=webkit-iphone'] },
];

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const build = spawnSync(pnpm, ['run', 'build'], { stdio: 'inherit', shell: process.platform === 'win32' });
if (build.status !== 0) {
  console.error('빌드가 실패해 E2E를 시작하지 않습니다.');
  process.exit(build.status ?? 1);
}

const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: resolve('.cache/ms-playwright') };
const results = [];
for (const group of GROUPS) {
  console.log(`\n===== ${group.name} =====`);
  const started = Date.now();
  const run = spawnSync(
    process.execPath,
    [resolve('node_modules/@playwright/test/cli.js'), 'test', '--reporter=list,json', ...group.args],
    { stdio: ['inherit', 'inherit', 'inherit'], env: { ...env, PLAYWRIGHT_JSON_OUTPUT_NAME: groupReport(group.name) } },
  );
  results.push({ name: group.name, status: run.status ?? 1, seconds: Math.round((Date.now() - started) / 1000) });
}

console.log('\n===== 전체 E2E 결과 =====');
for (const result of results) {
  const counts = readCounts(groupReport(result.name));
  const verdict = result.status === 0 ? '통과' : '실패';
  console.log(`${result.name}: ${verdict} · ${counts} · ${result.seconds}초`);
}
const failed = results.filter((result) => result.status !== 0);
if (failed.length > 0) {
  console.error(`실패한 묶음: ${failed.map((result) => result.name).join(', ')}`);
  process.exit(1);
}

function groupReport(name) {
  return resolve('.cache', `e2e-all-${name.replace(/\W+/g, '-')}.json`);
}

function readCounts(path) {
  try {
    const stats = JSON.parse(readFileSync(path, 'utf8')).stats;
    return `통과 ${stats.expected} · 실패 ${stats.unexpected} · 불안정 ${stats.flaky} · 건너뜀 ${stats.skipped}`;
  } catch {
    return '수를 읽지 못함(묶음이 중간에 끝났을 수 있음)';
  }
}
