import { defineConfig } from 'vitest/config';

// T-D0 프로브 전용. 기본 `pnpm run test`의 include(tests/**)에는 들어가지 않는다.
export default defineConfig({
  test: {
    root: process.cwd(),
    include: ['docs/d00/*.probe.ts'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    testTimeout: 30_000,
  },
});
