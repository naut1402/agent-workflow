import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

// E2E for features/agent-editor — ported from scripts/verify-agent-editor.mjs.
// Mode mount + create/save a custom agent + open the template & NL modals.

const EVIDENCE = path.resolve(process.cwd(), 'docs', 'features-agent-editor-evidence')

test('agent editor: mount, save agent, open template & NL modals (capture)', async ({ page }) => {
  fs.mkdirSync(EVIDENCE, { recursive: true })
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: 'Agent Editor' }).click()
  await expect(page.locator('.agent-editor')).toBeVisible({ timeout: 15_000 })

  // Create + save a custom agent → appears in the list.
  await page.getByRole('button', { name: '+ New' }).click()
  await page.locator('.agent-basic-fields input').first().fill('e2e-verify-agent')
  await page.locator('.agent-toolbar').getByRole('button', { name: 'Lưu' }).click()
  await expect(page.locator('.agent-list-item', { hasText: 'e2e-verify-agent' })).toBeVisible({ timeout: 10_000 })

  await page.screenshot({ path: path.join(EVIDENCE, 'agent-editor.png'), fullPage: true })

  // Template picker modal opens then closes.
  await page.getByRole('button', { name: 'Template / Copy' }).click()
  await expect(page.locator('.agent-template-picker')).toBeVisible()
  await page.locator('.agent-template-picker').getByRole('button', { name: 'Đóng' }).click()

  // NL wizard modal opens.
  await page.getByRole('button', { name: 'Build NL' }).click()
  await expect(page.locator('.agent-nl-wizard')).toBeVisible()

  fs.writeFileSync(
    path.join(EVIDENCE, 'verify-results.json'),
    JSON.stringify(
      {
        feature: 'features-agent-editor',
        checks: [
          { name: 'editor shell mounts', ok: true },
          { name: 'create + save custom agent → listed', ok: true },
          { name: 'template picker + NL wizard modals open', ok: true },
        ],
        capturedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  )
})
