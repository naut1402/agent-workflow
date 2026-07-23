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

// B0001: short viewport — body scrolls, head stays visible in dialog frame.
test('settings dialog: overflow body scroll at short viewport (capture)', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 400 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('.tasklist')).toBeVisible({ timeout: 15_000 })

  await page.locator('button[title="Cài đặt"]').click()
  const dialog = page.locator('.modal-backdrop .settings-dialog')
  await expect(dialog).toBeVisible()

  const head = dialog.locator('.modal-head')
  const body = dialog.locator('.modal-body')
  await expect(head).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Cài đặt' })).toBeVisible()

  const scrollable = await body.evaluate((el) => el.scrollHeight > el.clientHeight)
  expect(scrollable).toBe(true)

  // Head stays inside the dialog box (not pushed off-frame by tall content).
  const dialogBox = await dialog.boundingBox()
  const headBox = await head.boundingBox()
  expect(dialogBox).toBeTruthy()
  expect(headBox).toBeTruthy()
  expect(headBox!.y).toBeGreaterThanOrEqual(dialogBox!.y - 1)
  expect(headBox!.y + headBox!.height).toBeLessThanOrEqual(dialogBox!.y + dialogBox!.height + 1)

  await capture(page, testInfo, 'settings-dialog-overflow')
})
