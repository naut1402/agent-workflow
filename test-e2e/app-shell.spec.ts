import { test, expect } from '@playwright/test'
import { capturePage } from './_capture'

// Regression capture for the src-foundation refactor (src/api + src/core).
// Confirms the app shell + monitor mode still render after moving the API
// client, composables and shared UI — if any import broke, the SPA would not
// mount and these assertions would fail. Screenshots attach via testInfo
// (playwright-report / CI artifact test-evidence).

test('monitor mode renders the fixture task (capture)', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  // The fixture task id flows through /api/tasks → api client → TaskList.
  const taskId = page.locator('.tasklist .id', { hasText: 'DEMO-1' })
  await expect(taskId).toBeVisible({ timeout: 15_000 })

  await capturePage(page, testInfo, 'monitor-mode')
})
