import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

// E2E for features/runner — ported from scripts/verify-runners.mjs.
// Runner Config mode mount + create/save a runner → appears in the list.
// Writes go to the isolated DEV_TEAM_DASHBOARD_HOME (see playwright.config).

const EVIDENCE = path.resolve(process.cwd(), 'docs', 'features-runner-evidence')

test('runner config: mount + save runner roundtrip (capture)', async ({ page }) => {
  fs.mkdirSync(EVIDENCE, { recursive: true })
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await page.locator('button[title="Runner Config"]').click()
  await expect(page.locator('.runner-config')).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: '+ Local' }).click()
  const inputs = page.locator('.runner-form input')
  await inputs.nth(0).fill('e2e-runner')
  await inputs.nth(1).fill('E2E Runner')
  await page.getByRole('button', { name: 'Lưu' }).click()

  await expect(
    page.locator('.runner-list li').filter({ hasText: /E2E Runner|e2e-runner/ }).first(),
  ).toBeVisible({ timeout: 10_000 })

  await page.screenshot({ path: path.join(EVIDENCE, 'runner-config.png'), fullPage: true })
  fs.writeFileSync(
    path.join(EVIDENCE, 'verify-results.json'),
    JSON.stringify(
      {
        feature: 'features-runner',
        checks: [
          { name: 'runner config panel mounts', ok: true },
          { name: 'create + save runner → listed', ok: true },
        ],
        capturedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  )
})
