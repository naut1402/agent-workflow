import { test, expect } from '@playwright/test'
import { capture } from './_capture'

// E2E for features/logs — the "Nhật ký" mode. Boots the standalone server
// against the fixture .dev-team-agent + isolated DEV_TEAM_DASHBOARD_HOME
// (see playwright.config). Refactor breaking the import → SPA won't mount →
// .logs-panel never appears → CI red.

test('logs mode: mount + tab switch (capture)', async ({ page }, testInfo) => {
  await page.goto('/')
  // ⚠️ Không dùng waitForLoadState('networkidle') — SSE task/job list (#348)
  // giữ kết nối mở vô thời hạn nên network không bao giờ "idle", chờ nó luôn
  // timeout dù trang đã render xong. Locator wait bên dưới (`.click()` /
  // `toBeVisible()` / …) tự chờ phần tử actionable, không cần networkidle.

  await page.locator('button[title="Nhật ký"]').click()
  await expect(page.locator('.logs-panel')).toBeVisible({ timeout: 15_000 })

  // Default tab is Audit; switch to Request then Jobs to exercise each loader.
  await page.locator('.logs-tabs button', { hasText: 'Yêu cầu' }).click()
  await expect(page.locator('.logs-table')).toBeVisible()

  await page.locator('.logs-tabs button', { hasText: 'Jobs' }).click()
  await expect(page.locator('.logs-table-jobs')).toBeVisible()

  await capture(page, testInfo, 'logs')
})
