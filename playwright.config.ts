import { defineConfig, devices } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// E2E tests boot the full stack (standalone server serving the built SPA + a
// fixture .dev-team-agent/ as DEV_TEAM_ROOT). Screenshots go to testInfo.outputPath
// + attach (playwright-report), not docs/.
const PORT = Number(process.env.E2E_PORT || 4319)
const baseURL = process.env.E2E_BASE_URL || `http://127.0.0.1:${PORT}`
const fixtureRoot = path.resolve(process.cwd(), 'test-e2e/fixtures/project/.dev-team-agent')

// Máy dev không có root không cài được sysdeps của chromium vào /usr/lib. Script
// .github/scripts/setup-e2e-sysdeps.sh dựng chúng vào một prefix trong $HOME; ở đây
// ta trỏ browser vào prefix đó khi nó tồn tại. Không có prefix (CI, máy đã cài đủ
// lib bằng root) thì toàn bộ khối này là no-op.
const sysdepsPrefix =
  process.env.PW_SYSDEPS_PREFIX || path.join(os.homedir(), '.cache/pw-sysdeps')
const sysdepsLib = path.join(sysdepsPrefix, 'usr/lib/x86_64-linux-gnu')
const hasSysdeps = fs.existsSync(sysdepsLib)

// XDG_DATA_DIRS là bắt buộc chứ không phải tuỳ chọn: máy không có /usr/share/fonts
// thì chrome vẫn chạy nhưng mọi text render ra bề rộng 0px, và Playwright coi phần
// tử bounding-box rỗng là "không visible" -> đỏ hàng loạt với lý do sai.
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
        // Đặt ở use của project (sau spread devices) chứ không ở use cấp trên —
        // tránh phụ thuộc vào thứ tự merge giữa hai tầng.
        ...(browserEnv ? { launchOptions: { env: browserEnv } } : {}),
      },
    },
  ],
  // Build the SPA then serve it via the standalone server pointed at the fixture
  // workspace. reuseExistingServer locally so repeated runs are fast.
  webServer: {
    command: 'bun run build && bun src/standalone.ts',
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
