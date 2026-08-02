import { test, expect } from '@playwright/test'
import { capture } from './_capture'

// E2E for features/logs — the "Nhật ký" mode. Boots the standalone server
// against the fixture .dev-team-agent + isolated DEV_TEAM_DASHBOARD_HOME
// (see playwright.config). Refactor breaking the import → SPA won't mount →
// .logs-panel never appears → CI red.

test('logs mode: mount + tab switch (capture)', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await page.locator('button[title="Nhật ký"]').click()
  await expect(page.locator('.logs-panel')).toBeVisible({ timeout: 15_000 })

  // Default tab is Audit; switch to Request then Jobs to exercise each loader.
  await page.locator('.logs-tabs button', { hasText: 'Yêu cầu' }).click()
  await expect(page.locator('.logs-table')).toBeVisible()

  await page.locator('.logs-tabs button', { hasText: 'Jobs' }).click()
  await expect(page.locator('.jobs-layout')).toBeVisible()

  await capture(page, testInfo, 'logs')
})
