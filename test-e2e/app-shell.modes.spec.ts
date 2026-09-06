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
  // Prefix match: the active mode's tooltip gains a "— Thu gọn/Mở panel" suffix
  // once it owns a sub-sidebar, so an exact title match would be brittle.
  await page.locator('button[title^="Runner Config"]').click()
  await expect(page.locator('.runner-config')).toBeVisible()
  await capturePage(page, testInfo, 'runner-config')

  // Correction B (F0005): mode rail has a 7th mode, Quick Action.
  await page.locator('button[title^="Quick Action"]').click()
  await expect(page.locator('.quick-action-panel')).toBeVisible()
  await capturePage(page, testInfo, 'quick-action')

  // Back to monitor — polling resumes, task list renders again.
  await page.locator('button[title^="Monitor"]').click()
  await expect(page.locator('.tasklist--active')).toBeVisible()

  // Sidebar collapse toggle (ported from verify-ux UX1a).
  const sidebar = page.locator('.sidebar')
  await page.locator('.sidebar-toggle').click()
  await expect(sidebar).toHaveClass(/sidebar-collapsed/)
  await page.locator('.sidebar-toggle').click()
  await expect(sidebar).not.toHaveClass(/sidebar-collapsed/)
})

// T03d3dc9e: the per-panel collapse buttons are gone — clicking the already
// active mode icon is now the only way to hide/show that mode's sub-sidebar.
test('mode icon toggles the sub-sidebar of the active mode (capture)', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const monitorBtn = page.locator('button[title^="Monitor"]')
  const monitorLayout = page.locator('.monitor-layout')
  const subSidebar = page.locator('.monitor-sub-sidebar')

  await expect(page.locator('.tasklist--active')).toBeVisible({ timeout: 15_000 })
  await expect(monitorBtn).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.monitor-sub-sidebar-collapse-btn')).toHaveCount(0)
  await capturePage(page, testInfo, 'monitor-sub-sidebar-expanded')

  // Active mode + sub-sidebar showing → one click hides it, mode stays Monitor.
  await monitorBtn.click()
  await expect(monitorLayout).toHaveClass(/monitor-layout--sub-collapsed/)
  await expect(monitorBtn).toHaveAttribute('aria-expanded', 'false')
  await expect(monitorBtn).toHaveClass(/active/)
  await expect(page.locator('.tasklist--active')).toHaveCount(0)
  // No leftover empty rail where the removed button used to sit. The column width is
  // transitioned (0.2s), so poll instead of reading the box once mid-animation.
  await expect.poll(async () => (await subSidebar.boundingBox())?.width ?? 0).toBeLessThanOrEqual(1)
  await capturePage(page, testInfo, 'monitor-sub-sidebar-collapsed')

  // Click again → shows it back.
  await monitorBtn.click()
  await expect(monitorLayout).not.toHaveClass(/monitor-layout--sub-collapsed/)
  await expect(monitorBtn).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.tasklist--active')).toBeVisible()

  // Editor: selecting the mode must not toggle its panel; clicking again must.
  const editorBtn = page.locator('button[title^="Pipeline Editor"]')
  await editorBtn.click()
  await expect(page.locator('.editor-left')).not.toHaveClass(/editor-left-collapsed/)
  await expect(page.locator('.editor-left-collapse-btn')).toHaveCount(0)
  await capturePage(page, testInfo, 'editor-sub-sidebar-expanded')

  await editorBtn.click()
  await expect(page.locator('.editor-left')).toHaveClass(/editor-left-collapsed/)
  // Editor keeps its icon rail (Agents/Rules) instead of shrinking to zero.
  await expect(page.locator('.target-section-icon')).toHaveCount(2)
  await capturePage(page, testInfo, 'editor-sub-sidebar-collapsed')

  // Reopening from inside the panel keeps the mode icon's state in sync.
  await page.locator('.target-section-icon').first().click()
  await expect(page.locator('.editor-left')).not.toHaveClass(/editor-left-collapsed/)
  await expect(editorBtn).toHaveAttribute('aria-expanded', 'true')
})
