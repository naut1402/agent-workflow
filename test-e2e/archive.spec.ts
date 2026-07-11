import { test, expect } from '@playwright/test'
import { capture } from './_capture'

// E2E for the archive/unarchive flow (Tab Monitor): the archive button shows for
// every task regardless of current_phase. Archiving DEMO-2 moves it out of the
// main list into the "Đã lưu trữ" collapsible group (collapsed by default);
// opening the group reveals it with an unarchive button, and unarchiving
// restores the original state.

test('archive then unarchive a task (capture)', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const mainList = page.locator('.tasklist').first()
  const row = mainList.locator('.task-entry', { hasText: 'DEMO-2' })
  await expect(row).toBeVisible({ timeout: 15_000 })

  await row.locator('.btn-archive').click()
  await expect(mainList.locator('.task-entry', { hasText: 'DEMO-2' })).toHaveCount(0)

  const group = page.locator('.archived-group')
  await expect(group).toBeVisible()
  await expect(group.locator('summary')).toContainText('Đã lưu trữ (1)')

  const archivedRow = group.locator('.task-entry', { hasText: 'DEMO-2' })
  await expect(archivedRow).toBeHidden() // collapsed by default

  await capture(page, testInfo, 'archive-hidden-after-archive')

  await group.locator('summary').click()
  await expect(archivedRow).toBeVisible()

  await capture(page, testInfo, 'archive-visible-with-filter')

  await archivedRow.locator('.btn-archive').click()
  await expect(mainList.locator('.task-entry', { hasText: 'DEMO-2' })).toBeVisible()
})
