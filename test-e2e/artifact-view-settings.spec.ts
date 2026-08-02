import { test, expect } from '@playwright/test'
import { capture } from './_capture'

const STORAGE_KEY = 'dev-dashboard-app-settings'

test('artifact view preference: Settings → open artifact (capture)', async ({ page }, testInfo) => {
  await page.addInitScript((key) => {
    try {
      localStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  }, STORAGE_KEY)

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const row = page.locator('.task-row', { hasText: 'DEMO-1' })
  await expect(row).toBeVisible({ timeout: 15_000 })
  await row.click()

  await page.locator('.file-item .file-name', { hasText: 'investigate.md' }).click()
  await expect(page.locator('.art-view .block-list')).toBeVisible()
  await capture(page, testInfo, 'artifact-view-block')

  await page.locator('button[title="Cài đặt"]').click()
  await expect(page.locator('.settings-dialog')).toBeVisible()
  await page.locator('input[name="artifactViewMode"][value="full"]').check()
  await page.locator('.settings-dialog .modal-close').click()
  await expect(page.locator('.settings-dialog')).toHaveCount(0)

  // Preference applies on next open — switch artifact identity.
  await page.locator('.file-item .file-name', { hasText: 'design.md' }).click()
  await expect(page.locator('.art-view .block-list')).toHaveCount(0)
  await expect(page.locator('.art-view .md-section-wrap')).toBeVisible()
  await capture(page, testInfo, 'artifact-view-full')

  await page.locator('button[title="Cài đặt"]').click()
  await page.locator('input[name="artifactViewMode"][value="block"]').check()
  await page.locator('.settings-dialog .modal-close').click()

  await page.locator('.file-item .file-name', { hasText: 'investigate.md' }).click()
  await expect(page.locator('.art-view .block-list')).toBeVisible()
})
