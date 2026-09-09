import { test, expect } from '@playwright/test'
import { capturePage } from './_capture'

// E2E for features/agent-editor — ported from scripts/verify-agent-editor.mjs.
// Mode mount + create/save a custom agent + open the template & NL modals.

test('agent editor: mount, save agent, open template & NL modals (capture)', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: 'Agent Editor' }).click()
  await expect(page.locator('.agent-editor')).toBeVisible({ timeout: 15_000 })

  // Create + save a custom agent → appears in the list.
  await page.getByRole('button', { name: '+ New' }).click()
  await page.locator('.agent-basic-fields input').first().fill('e2e-verify-agent')
  await page.locator('.agent-toolbar').getByRole('button', { name: 'Lưu' }).click()
  await expect(page.locator('.agent-list-item', { hasText: 'e2e-verify-agent' })).toBeVisible({ timeout: 10_000 })

  await capturePage(page, testInfo, 'agent-editor')

  // Template picker modal opens then closes.
  await page.getByRole('button', { name: 'Template / Copy' }).click()
  await expect(page.locator('.agent-template-picker')).toBeVisible()
  await page.locator('.agent-template-picker').getByRole('button', { name: 'Đóng' }).click()

  // NL wizard modal opens.
  await page.getByRole('button', { name: 'Build NL' }).click()
  await expect(page.locator('.agent-nl-wizard')).toBeVisible()
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
