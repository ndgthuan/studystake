import { defineConfig, devices } from '@playwright/test';

// E2E runs against a local chain on 8545 with the oracle dev server on 8788 and `next start` on 3000.
// scripts/e2e_setup.mjs starts them: `npm run e2e` does everything, `npm run e2e:setup` only starts the stack.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'off',
    screenshot: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
