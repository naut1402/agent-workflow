import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'

// E2E tests boot the full stack (standalone server serving the built SPA + a
// fixture .dev-team-agent/ as DEV_TEAM_ROOT) and capture screenshots into
// docs/<feature>-evidence/ as confirmation that each frontend refactor still
// renders. Migrated incrementally from the legacy scripts/verify-*.mjs.
const PORT = Number(process.env.E2E_PORT || 4319)
const baseURL = process.env.E2E_BASE_URL || `http://127.0.0.1:${PORT}`
const fixtureRoot = path.resolve(process.cwd(), 'test-e2e/fixtures/project/.dev-team-agent')

export default defineConfig({
  testDir: './test-e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Build the SPA then serve it via the standalone server pointed at the fixture
  // workspace. reuseExistingServer locally so repeated runs are fast.
  webServer: {
    command: 'bun run build && bun server/standalone.ts',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      DEV_TEAM_ROOT: fixtureRoot,
      DEV_TEAM_DASHBOARD_PORT: String(PORT),
      DEV_TEAM_DASHBOARD_HOST: '127.0.0.1',
      // Isolate the registry/runners/jobs store so CRUD specs don't touch the
      // developer's real ~/.dev-team-dashboard (and stay deterministic in CI).
      DEV_TEAM_DASHBOARD_HOME: path.resolve(process.cwd(), 'test-e2e/.runtime/home'),
    },
  },
})
