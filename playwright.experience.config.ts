import { defineConfig } from '@playwright/test'

/** Isolated production-build measurement; excluded from the ordinary functional suite. */
export default defineConfig({
  testDir: './tests',
  testMatch: 'experience-benchmark.check.ts',
  workers: 1,
  retries: 0,
  timeout: 180_000,
  reporter: 'list',
  outputDir: '/tmp/eavesly-experience-benchmark-results',
  use: { baseURL: 'http://127.0.0.1:4190', viewport: { width: 1440, height: 1000 } },
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4190 --strictPort',
    url: 'http://127.0.0.1:4190',
    timeout: 120_000,
    reuseExistingServer: false,
  },
})
