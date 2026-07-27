import { test, expect } from '@playwright/test'
import { capturePage } from './_capture'

// E2E capture for the app-shell: sidebar mode switching across all five modes
// (the shell + useTaskPolling extraction). Confirms each mode's root panel
// mounts and the runner mode (RunnerConfigPanel, moved to features/runner) works.

test('sidebar switches across modes incl. runner (capture)', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  // Monitor (default) → active task list present.
  await expect(page.locator('.tasklist--active')).toBeVisible({ timeout: 15_000 })

  // Correction A (F0005): the Monitor-only NL build entry is gone — "Build NL"
  // now lives solely in Agent Editor.
  await expect(page.getByRole('button', { name: '⚡ Tạo agent' })).toHaveCount(0)

  // Runner Config mode (RunnerConfigPanel relocated to features/runner).
  // Click via the title attr — the button's visible label is "Runner".
  await page.locator('button[title="Runner Config"]').click()
  await expect(page.locator('.runner-config')).toBeVisible()
  await capturePage(page, testInfo, 'runner-config')

  // Correction B (F0005): mode rail has a 7th mode, Quick Action.
  await page.locator('button[title="Quick Action"]').click()
  await expect(page.locator('.quick-action-panel')).toBeVisible()
  await capturePage(page, testInfo, 'quick-action')

  // Back to monitor — polling resumes, task list renders again.
  await page.locator('button[title="Monitor"]').click()
  await expect(page.locator('.tasklist--active')).toBeVisible()

  // Sidebar collapse toggle (ported from verify-ux UX1a).
  const sidebar = page.locator('.sidebar')
  await page.locator('.sidebar-toggle').click()
  await expect(sidebar).toHaveClass(/sidebar-collapsed/)
  await page.locator('.sidebar-toggle').click()
  await expect(sidebar).not.toHaveClass(/sidebar-collapsed/)
})
