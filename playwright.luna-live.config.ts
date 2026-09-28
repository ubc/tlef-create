import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', testMatch: /authoring-luna-live.*\.ts/,
  outputDir: 'test-results/luna-live/playwright', workers: 1, retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:8092', screenshot: 'only-on-failure', trace: 'on-first-retry' },
  webServer: [
    { command: 'node scripts/start-luna-e2e-backend.mjs', url: 'http://localhost:8051/health',
      reuseExistingServer: false, timeout: 120000, gracefulShutdown: { signal: 'SIGTERM', timeout: 30000 }, stdout: 'ignore', stderr: 'pipe' },
    { command: 'npm run build && npm run preview -- --host localhost --port 8092', url: 'http://localhost:8092',
      reuseExistingServer: false, timeout: 120000, stdout: 'ignore', stderr: 'pipe' }
  ],
  projects: [
    { name: 'setup', testMatch: /authoring-luna-live\.auth\.setup\.ts/ },
    { name: 'chromium', use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/luna-e2e.json' }, dependencies: ['setup'], testMatch: /authoring-luna-live\.spec\.ts/ },
    { name: 'complex', use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/luna-e2e.json' }, dependencies: ['setup'], testMatch: /authoring-luna-live\.complex\.spec\.ts/ }
  ]
});
