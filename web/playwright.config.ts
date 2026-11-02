import { defineConfig, devices } from '@playwright/test';

// E2E runs against Anvil (chain 31337) with the oracle dev server on 8788 and `next start` on 3000.
// Those three are started by the e2e:setup script (scripts/e2e_setup.mjs) before the tests run.
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
