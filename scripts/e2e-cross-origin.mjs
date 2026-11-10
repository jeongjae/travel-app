// T-D4 C1: VITE_AI_API_BASE를 넣어 따로 빌드한 앱을 열어 Pages→Worker 교차 출처 호출을 확인한다.
// 가상 패스키·로컬 Worker·가짜 OpenAI만 쓴다. 빌드 폴더는 임시 폴더에 둔다.
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outDir = join(mkdtempSync(join(tmpdir(), 'travel-app-cross-')), 'dist');
const run = (args, env) =>
  spawnSync(process.execPath, args, { stdio: 'inherit', env: { ...process.env, ...env } }).status ?? 1;

const built = run(
  ['node_modules/vite/bin/vite.js', 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'],
  {
    VITE_AI_API_BASE: 'http://127.0.0.1:8787',
  },
);
if (built !== 0) {
  process.exit(built);
}
process.exit(
  run(['scripts/playwright.mjs', 'test', 'tests/e2e/ai-cross-origin.spec.ts'], { E2E_CROSS_ORIGIN_DIST: outDir }),
);
