import { defineConfig, devices } from '@playwright/test';

// Runs against an isolated local database, vector collection and H5P storage.
// Dedicated ports keep the instructor's normal development server untouched.
export default defineConfig({
  testDir: './e2e', testMatch: /authoring-luna-live\.stress\.spec\.ts/,
  outputDir: 'test-results/luna-stress/playwright', workers: 1, retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:8093', screenshot: 'only-on-failure' },
  webServer: [
    { command: 'LUNA_E2E_API_PORT=8152 LUNA_E2E_FRONTEND_PORT=8093 node scripts/start-luna-e2e-backend.mjs',
      url: 'http://localhost:8152/health', reuseExistingServer: false, timeout: 120000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 30000 }, stdout: 'ignore', stderr: 'ignore' },
    { command: 'VITE_API_URL=http://localhost:8152 npm run build && npm run preview -- --host localhost --port 8093',
      url: 'http://localhost:8093', reuseExistingServer: false, timeout: 120000, stdout: 'ignore', stderr: 'pipe' }
  ],
  projects: [
    { name: 'setup', testMatch: /authoring-luna-live\.auth\.setup\.ts/ },
    { name: 'stress', use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/luna-e2e.json' },
      dependencies: ['setup'], testMatch: /authoring-luna-live\.stress\.spec\.ts/ }
  ]
});
