import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

// E2E capture for the features/knowledge module. Switches to Knowledge mode and
// confirms the panel mounts after the feature-module migration.

const EVIDENCE = path.resolve(process.cwd(), 'docs', 'features-knowledge-evidence')

test('knowledge mode mounts the panel (capture)', async ({ page }) => {
  fs.mkdirSync(EVIDENCE, { recursive: true })

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: 'Knowledge' }).click()

  await expect(page.locator('.knowledge-panel')).toBeVisible({ timeout: 15_000 })

  await page.screenshot({ path: path.join(EVIDENCE, 'knowledge.png'), fullPage: true })

  fs.writeFileSync(
    path.join(EVIDENCE, 'verify-results.json'),
    JSON.stringify(
      {
        feature: 'features-knowledge',
        checks: [{ name: 'switch to Knowledge mode → panel mounts', ok: true }],
        capturedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  )
})
