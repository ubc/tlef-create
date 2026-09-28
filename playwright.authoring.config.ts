import { defineConfig } from '@playwright/test';

// Browser interaction/layout checks use deterministic HTTP fixtures. The
// separate Mongo integration suite exercises durable server mutations.
export default defineConfig({
  testDir: './e2e', testMatch: 'authoring-workspace.spec.ts',
  outputDir: 'test-results/authoring', workers: 1,
  use: { baseURL: 'http://127.0.0.1:8192', viewport: { width: 1440, height: 1050 } },
  webServer: { command: 'npm run dev:frontend -- --host 127.0.0.1 --port 8192',
    url: 'http://127.0.0.1:8192', reuseExistingServer: !process.env.CI, timeout: 60000 }
});
