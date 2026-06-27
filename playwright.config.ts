import { defineConfig, devices } from '@playwright/test'

// E2E tests live in e2e/<feature>.spec.ts and exercise the full stack
// (real server + a fixture .dev-team-agent/ root + a browser).
// Migrated from the legacy scripts/verify-*.mjs scripts in a later phase.
const PORT = Number(process.env.E2E_PORT || 5174)
const baseURL = process.env.E2E_BASE_URL || `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // webServer is intentionally disabled until real e2e specs land (e2e is
  // deferred per refactor-workflow.md). Re-enable when migrating
  // scripts/verify-*.mjs so Playwright boots the dev server for the suite:
  //
  // webServer: {
  //   command: `vite --port ${PORT} --open false`,
  //   url: baseURL,
  //   reuseExistingServer: !process.env.CI,
  //   timeout: 120_000,
  // },
})
