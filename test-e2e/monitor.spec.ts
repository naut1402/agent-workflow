import { test, expect } from '@playwright/test'
import { capture } from './_capture'

// E2E capture for the features/monitor module. Confirms the moved monitor
// components (TaskList → file list → ArtifactPanel) still wire up after the
// feature-module migration: select the fixture task, expand its artifacts.

test('select task expands artifact list (capture)', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const row = page.locator('.task-row', { hasText: 'DEMO-1' })
  await expect(row).toBeVisible({ timeout: 15_000 })
  await row.click()

  // The fixture task has investigate.md + design.md artifacts.
  await expect(page.locator('.file-item .file-name', { hasText: 'investigate.md' })).toBeVisible()

  // The per-task activity timeline renders alongside the pipeline view.
  await expect(page.locator('.task-timeline')).toBeVisible()

  await capture(page, testInfo, 'monitor-task-expanded')
})
