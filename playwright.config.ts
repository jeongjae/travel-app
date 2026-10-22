import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  webServer: {
    command: 'pnpm run preview:ui',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: process.env.TRAVEL_APP_REUSE_PREVIEW === '1',
    timeout: 30000,
  },
});
