import { test, expect } from '@playwright/test'
import { capture } from './_capture'

// Settings dialog shell (F0007-1): open/close via footer icon, Esc, backdrop;
// does not change mode; works expanded + collapsed. Capture via _capture helper.

test('settings dialog: open/close expanded + collapsed (capture)', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await expect(page.locator('.tasklist')).toBeVisible({ timeout: 15_000 })

  // Open Settings — outside .mode-toggle.
  await page.locator('button[title="Cài đặt"]').click()
  await expect(page.locator('.modal-backdrop .settings-dialog')).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Cài đặt' })).toBeVisible()

  // Still on monitor — task list remains (mode unchanged).
  await expect(page.locator('.tasklist')).toBeVisible()

  await capture(page, testInfo, 'settings-dialog')

  // Close via ✕
  await page.locator('.settings-dialog .modal-close').click()
  await expect(page.locator('.settings-dialog')).toHaveCount(0)

  // Collapse sidebar → Settings icon still available.
  await page.locator('.sidebar-toggle').click()
  await expect(page.locator('.sidebar')).toHaveClass(/sidebar-collapsed/)
  await page.locator('button[title="Cài đặt"]').click()
  await expect(page.locator('.modal-backdrop .settings-dialog')).toBeVisible()

  await capture(page, testInfo, 'settings-dialog-collapsed')

  // Esc closes
  await page.keyboard.press('Escape')
  await expect(page.locator('.settings-dialog')).toHaveCount(0)

  // Backdrop click closes
  await page.locator('button[title="Cài đặt"]').click()
  await expect(page.locator('.settings-dialog')).toBeVisible()
  await page.locator('.modal-backdrop').click({ position: { x: 4, y: 4 } })
  await expect(page.locator('.settings-dialog')).toHaveCount(0)
})
