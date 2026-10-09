import { defineConfig, devices } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PORT = Number(process.env.E2E_PORT || 4319)
const baseURL = process.env.E2E_BASE_URL || `http://127.0.0.1:${PORT}`
const fixtureRoot = path.resolve(process.cwd(), 'test-e2e/fixtures/project/.dev-team-agent')

// xem docs/agent-rules/testing.md §2.5
const sysdepsPrefix =
  process.env.PW_SYSDEPS_PREFIX || path.join(os.homedir(), '.cache/pw-sysdeps')
const sysdepsLib = path.join(sysdepsPrefix, 'usr/lib/x86_64-linux-gnu')
const hasSysdeps = fs.existsSync(sysdepsLib)

const browserEnv = hasSysdeps
  ? {
      ...(Object.fromEntries(
        Object.entries(process.env).filter(([, v]) => v !== undefined),
      ) as Record<string, string>),
      LD_LIBRARY_PATH: [sysdepsLib, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
      XDG_DATA_DIRS: [
        path.join(sysdepsPrefix, 'usr/share'),
        process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share',
      ].join(':'),
    }
  : undefined

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
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(browserEnv ? { launchOptions: { env: browserEnv } } : {}),
      },
    },
  ],
  webServer: {
    command: 'bun run build && bun src/backend/standalone.ts',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      DEV_TEAM_ROOT: fixtureRoot,
      DEV_TEAM_DASHBOARD_PORT: String(PORT),
      DEV_TEAM_DASHBOARD_HOST: '127.0.0.1',
      DEV_TEAM_DASHBOARD_HOME: path.resolve(process.cwd(), 'test-e2e/.runtime/home'),
    },
  },
})
