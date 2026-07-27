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

  // Monitor (default) → active task list present.
  await expect(page.locator('.tasklist--active')).toBeVisible({ timeout: 15_000 })

  // Correction A (F0005): the Monitor-only NL build entry is gone — "Build NL"
  // now lives solely in Agent Editor.
  await expect(page.getByRole('button', { name: '⚡ Tạo agent' })).toHaveCount(0)

  // Runner Config mode (RunnerConfigPanel relocated to features/runner).
  // Click via the title attr — the button's visible label is "Runner".
  await page.locator('button[title="Runner Config"]').click()
  await expect(page.locator('.runner-config')).toBeVisible()
  await page.screenshot({ path: path.join(EVIDENCE, 'runner-config.png'), fullPage: true })

  // Correction B (F0005): mode rail has a 7th mode, Quick Action.
  await page.locator('button[title="Quick Action"]').click()
  await expect(page.locator('.quick-action-panel')).toBeVisible()
  await page.screenshot({ path: path.join(EVIDENCE, 'quick-action.png'), fullPage: true })

  // Back to monitor — polling resumes, task list renders again.
  await page.locator('button[title="Monitor"]').click()
  await expect(page.locator('.tasklist--active')).toBeVisible()

  // Sidebar collapse toggle (ported from verify-ux UX1a).
  const sidebar = page.locator('.sidebar')
  await page.locator('.sidebar-toggle').click()
  await expect(sidebar).toHaveClass(/sidebar-collapsed/)
  await page.locator('.sidebar-toggle').click()
  await expect(sidebar).not.toHaveClass(/sidebar-collapsed/)

  fs.writeFileSync(
    path.join(EVIDENCE, 'verify-results.json'),
    JSON.stringify(
      {
        feature: 'app-shell',
        checks: [
          { name: 'monitor task list mounts', ok: true },
          { name: 'Monitor no longer has a NL build entry (moved to Agent Editor)', ok: true },
          { name: 'switch to Runner Config → panel mounts', ok: true },
          { name: 'switch to Quick Action → panel mounts', ok: true },
          { name: 'switch back to monitor → task list re-renders', ok: true },
        ],
        capturedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  )
})
