import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { e2eWorker } from './tests/e2e/helpers/worker';

// E2E 전용 Worker 값. 모두 가상 값이며 실제 OpenAI·Cloudflare에 닿지 않는다.
const workerVars = [
  `OPENAI_BASE:${e2eWorker.fakeOpenAi}/v1`,
  'OPENAI_API_KEY:fictional-e2e-key',
  `OPENAI_MODEL:${e2eWorker.model}`,
  'TOKEN_SECRET:fictional-e2e-token-secret-0123456789abcdef',
  `REGISTRATION_CODE:${e2eWorker.registrationCode}`,
  'E2E_RESET:1',
].flatMap((value) => ['--var', value]);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  outputDir: join(tmpdir(), 'travel-app-playwright'),
  timeout: 30000,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1504, height: 1040 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
  // Opt in only after verifying that the listener belongs to this checkout's Vite preview.
  webServer: [
    {
      command: 'pnpm run preview:ui',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: process.env.TRAVEL_APP_REUSE_PREVIEW === '1',
      timeout: 30000,
    },
    {
      command: 'node scripts/fake-openai.ts',
      url: `${e2eWorker.fakeOpenAi}/__control/requests`,
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      // 로컬 workerd. 상태는 임시 폴더에 두고, 시험마다 /__test/reset으로 비운다.
      command: [
        'node node_modules/wrangler/bin/wrangler.js dev --config worker/wrangler.toml',
        '--ip 127.0.0.1 --port 8787 --show-interactive-dev-session=false',
        `--persist-to "${join(tmpdir(), 'travel-app-wrangler-e2e')}"`,
        ...workerVars,
      ].join(' '),
      url: `${e2eWorker.origin}/auth/state`,
      env: { WRANGLER_SEND_METRICS: 'false' },
      reuseExistingServer: false,
      timeout: 90000,
    },
  ],
});
