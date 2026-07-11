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

// Correction A: Build NL now offers a preview + optional smoke-run ("Lưu & chạy
// thử"), gated behind a usable runner — a fresh env has none configured, so the
// run button stays disabled with a CTA pointing at Runner mode. "Áp dụng vào
// editor" never needs a runner (draft-only, same as the old AS-IS behaviour).
test('agent editor Build NL: no usable runner → run disabled + CTA, apply-draft still works', async ({
  page,
}) => {
  await page.route('**/api/runners', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ runners: [], defaultRunnerId: null }),
    })
  })
  await page.route('**/api/custom-agents/generate', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ draft: { name: 'e2e-gate-agent', description: 'gate test' } }),
    })
  })

  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Agent Editor' }).click()
  await expect(page.locator('.agent-editor')).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: 'Build NL' }).click()
  await page.locator('.agent-nl-wizard textarea').fill('agent không cần runner')
  await page.getByRole('button', { name: 'Generate draft' }).click()

  await expect(page.locator('.agent-nl-wizard')).toContainText('Chưa có runner khả dụng')
  await expect(page.getByRole('button', { name: 'Lưu & chạy thử →' })).toBeDisabled()

  // Draft-only path still works without a runner.
  await page.getByRole('button', { name: 'Áp dụng vào editor' }).click()
  await expect(page.locator('.agent-nl-wizard')).toHaveCount(0)
  await expect(page.locator('.agent-basic-fields input').first()).toHaveValue('e2e-gate-agent')
})
