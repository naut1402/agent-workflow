import { test, expect } from '@playwright/test'
import { capture } from './_capture'

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

  await capture(page, testInfo, 'agent-editor')

  // Template picker modal opens then closes.
  await page.getByRole('button', { name: 'Template / Copy' }).click()
  await expect(page.locator('.agent-template-picker')).toBeVisible()
  await page.locator('.agent-template-picker').getByRole('button', { name: 'Đóng' }).click()

  // NL wizard modal opens.
  await page.getByRole('button', { name: 'Build NL' }).click()
  await expect(page.locator('.agent-nl-wizard')).toBeVisible()
})
