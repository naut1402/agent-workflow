import { test, expect } from '@playwright/test'
import { capture } from './_capture'

test('settings theme: light/dark persist + data-theme (capture)', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('.tasklist')).toBeVisible({ timeout: 15_000 })

  await page.locator('button[title="Cài đặt"]').click()
  await expect(page.getByRole('dialog', { name: 'Cài đặt' })).toBeVisible()

  // Default: Hệ thống
  await expect(page.locator('input[name="theme"][value="system"]')).toBeChecked()

  // Light
  await page.locator('input[name="theme"][value="light"]').check()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await capture(page, testInfo, 'theme-light')

  // Dark
  await page.locator('input[name="theme"][value="dark"]').check()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await capture(page, testInfo, 'theme-dark')

  // Persist across reload
  await page.locator('.settings-dialog .modal-close').click()
  await page.reload()
  await page.waitForLoadState('networkidle')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('dev-dashboard-app-settings') || '{}'),
  )
  expect(stored.theme).toBe('dark')

  // System follows OS (emulate light)
  await page.emulateMedia({ colorScheme: 'light' })
  await page.locator('button[title="Cài đặt"]').click()
  await page.locator('input[name="theme"][value="system"]').check()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await capture(page, testInfo, 'theme-system-os-light')

  await page.emulateMedia({ colorScheme: 'dark' })
  // Re-apply by toggling away and back so listener / setTheme runs
  await page.locator('input[name="theme"][value="dark"]').check()
  await page.locator('input[name="theme"][value="system"]').check()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await capture(page, testInfo, 'theme-system-os-dark')
})
