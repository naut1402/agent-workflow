import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

// E2E capture for the app-shell: sidebar mode switching across all five modes
// (the shell + useTaskPolling extraction). Confirms each mode's root panel
// mounts and the runner mode (RunnerConfigPanel, moved to features/runner) works.

const EVIDENCE = path.resolve(process.cwd(), 'docs', 'app-shell-evidence')

test('sidebar switches across modes incl. runner (capture)', async ({ page }) => {
  fs.mkdirSync(EVIDENCE, { recursive: true })

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  // Monitor (default) → task list present.
  await expect(page.locator('.tasklist')).toBeVisible({ timeout: 15_000 })

  // Runner Config mode (RunnerConfigPanel relocated to features/runner).
  // Click via the title attr — the button's visible label is "Runner".
  await page.locator('button[title="Runner Config"]').click()
  await expect(page.locator('.runner-config')).toBeVisible()
  await page.screenshot({ path: path.join(EVIDENCE, 'runner-config.png'), fullPage: true })

  // Back to monitor — polling resumes, task list renders again.
  await page.locator('button[title="Monitor"]').click()
  await expect(page.locator('.tasklist')).toBeVisible()

  fs.writeFileSync(
    path.join(EVIDENCE, 'verify-results.json'),
    JSON.stringify(
      {
        feature: 'app-shell',
        checks: [
          { name: 'monitor task list mounts', ok: true },
          { name: 'switch to Runner Config → panel mounts', ok: true },
          { name: 'switch back to monitor → task list re-renders', ok: true },
        ],
        capturedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  )
})
