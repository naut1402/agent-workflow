import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

// E2E capture for the features/monitor module. Confirms the moved monitor
// components (TaskList → file list → ArtifactPanel) still wire up after the
// feature-module migration: select the fixture task, expand its artifacts.

const EVIDENCE = path.resolve(process.cwd(), 'docs', 'features-monitor-evidence')

test('select task expands artifact list (capture)', async ({ page }) => {
  fs.mkdirSync(EVIDENCE, { recursive: true })

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const row = page.locator('.task-row', { hasText: 'DEMO-1' })
  await expect(row).toBeVisible({ timeout: 15_000 })
  await row.click()

  // The fixture task has investigate.md + design.md artifacts.
  await expect(page.locator('.file-item .file-name', { hasText: 'investigate.md' })).toBeVisible()

  await page.screenshot({ path: path.join(EVIDENCE, 'monitor-task-expanded.png'), fullPage: true })

  fs.writeFileSync(
    path.join(EVIDENCE, 'verify-results.json'),
    JSON.stringify(
      {
        feature: 'features-monitor',
        checks: [
          { name: 'task DEMO-1 selectable + artifact list expands (investigate.md visible)', ok: true },
        ],
        capturedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  )
})
