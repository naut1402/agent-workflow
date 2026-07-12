import { test, expect } from '@playwright/test'
import { capture } from './_capture'

// E2E for Correction B (F0005): the QuickAction mode CRUD panel, and the two
// places a saved action surfaces in Monitor's ArtifactPanel — the artifact
// title toolbar (attach: artifact-title) and the floating selection toolbar
// (attach: artifact-selection), shown when the user highlights text in the
// viewer. Only checks that the action *surfaces* in the UI — it never clicks
// "run" (that would submit a real job against whatever runner happens to be
// configured in the shared e2e home dir, which this spec doesn't control).
//
// The editor is a modal dialog; its fields are: label, artifact_patterns (both
// text inputs), an agent <select>, the prompt textarea, and the attach/confirm/
// approval checkboxes. There is no id field — the id is derived from the label.

test('quick action: CRUD → title button + selection toolbar (capture)', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await page.locator('button[title="Quick Action"]').click()
  await expect(page.locator('.quick-action-panel')).toBeVisible({ timeout: 15_000 })

  // ── Create a title-attached action ──────────────────────────────────────
  await page.getByRole('button', { name: '+ New' }).click()
  await expect(page.locator('.qa-form')).toBeVisible()
  const titleFormInputs = page.locator('.qa-form input.cfg-input') // [0]=label, [1]=patterns
  await titleFormInputs.nth(0).fill('QA Title E2E')
  await titleFormInputs.nth(1).fill('design.md')
  await page.locator('.qa-form textarea').fill('Đọc {{artifact_name}}')
  // Attach: "Artifact title" is checked by default.
  await page.locator('.qa-form .btn-primary').click()
  await expect(page.locator('.qa-form')).toHaveCount(0)
  await expect(page.locator('.qa-table')).toContainText('QA Title E2E')

  await capture(page, testInfo, 'quick-action-panel')

  // ── Create a selection-only action ──────────────────────────────────────
  await page.getByRole('button', { name: '+ New' }).click()
  const selFormInputs = page.locator('.qa-form input.cfg-input')
  await selFormInputs.nth(0).fill('QA Selection E2E')
  await selFormInputs.nth(1).fill('design.md')
  await page.locator('.qa-form textarea').fill('Giải thích: {{selection}}')
  await page.locator('.qa-form input[type="checkbox"]').first().uncheck() // Artifact title off
  await page.locator('.qa-form input[type="checkbox"]').nth(1).check() // Text selection on
  await page.locator('.qa-form .btn-primary').click()
  await expect(page.locator('.qa-form')).toHaveCount(0)
  await expect(page.locator('.qa-table')).toContainText('QA Selection E2E')

  // ── Title toolbar: shows the title-attached action, not the selection-only one ──
  await page.locator('button[title="Monitor"]').click()
  await expect(page.locator('.tasklist')).toBeVisible({ timeout: 15_000 })
  await page.locator('.task-row', { hasText: 'DEMO-1' }).click()
  await page.locator('.file-item .file-name', { hasText: 'design.md' }).click()

  await expect(page.locator('.art-toolbar-actions')).toContainText('QA Title E2E')
  await expect(page.locator('.art-toolbar-actions')).not.toContainText('QA Selection E2E')

  // ── Selection toolbar: appears only once text in the viewer is highlighted ──
  // Select the text programmatically (a dblclick would enter inline-edit mode,
  // which suppresses the selection toolbar). Setting a Range fires
  // `selectionchange`; also dispatch `mouseup` to match the composable's wiring.
  await expect(page.locator('.selection-toolbar')).toHaveCount(0)
  await page.evaluate(() => {
    const el = document.querySelector('.art-view .md')
    if (!el) throw new Error('no rendered markdown block')
    const sel = window.getSelection()!
    const range = document.createRange()
    range.selectNodeContents(el)
    sel.removeAllRanges()
    sel.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
  await expect(page.locator('.selection-toolbar')).toBeVisible()
  await expect(page.locator('.selection-toolbar')).toContainText('QA Selection E2E')
  await capture(page, testInfo, 'quick-action-selection-toolbar')
})
