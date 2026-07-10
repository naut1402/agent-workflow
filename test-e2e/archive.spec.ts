import { test, expect } from '@playwright/test'
import { capture } from './_capture'

// E2E for the archive/unarchive flow (Tab Monitor): the fixture task DEMO-2 has
// current_phase "completed" so it always shows an archive button. Archiving it
// hides it from the default list; ticking "Hiện task đã lưu trữ" brings it back
// with an unarchive button, and unarchiving restores the original state.

test('archive then unarchive a completed task (capture)', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const row = page.locator('.task-entry', { hasText: 'DEMO-2' })
  await expect(row).toBeVisible({ timeout: 15_000 })

  await row.locator('.btn-archive').click()
  await expect(page.locator('.task-entry', { hasText: 'DEMO-2' })).toHaveCount(0)

  await capture(page, testInfo, 'archive-hidden-after-archive')

  await page.locator('.archive-filter input').check()
  const archivedRow = page.locator('.task-entry', { hasText: 'DEMO-2' })
  await expect(archivedRow).toBeVisible()

  await capture(page, testInfo, 'archive-visible-with-filter')

  await archivedRow.locator('.btn-archive').click()
  await page.locator('.archive-filter input').uncheck()
  await expect(page.locator('.task-entry', { hasText: 'DEMO-2' })).toBeVisible()
})
