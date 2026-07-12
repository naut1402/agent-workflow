import { test, expect } from '@playwright/test'
import { capture } from './_capture'

// E2E capture for the merged NL build wizard (F0005 Correction A): the
// Monitor-only «⚡ Tạo agent» entry (+ AgentBuildWizard) is gone — this flow now
// lives entirely in Agent Editor «Build NL» → describe → preview draft.
// Generate is mocked so the spec stays deterministic without ANTHROPIC_API_KEY
// or a live runner.

test('agent editor Build NL wizard: describe → preview (capture)', async ({ page }, testInfo) => {
  await page.route('**/api/custom-agents/generate', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        draft: {
          name: 'e2e-wizard-agent',
          description: 'Agent kiểm tra E2E wizard',
          skills: ['coding-rules'],
          sections: { intro: 'Smoke test agent' },
        },
      }),
    })
  })

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: 'Agent Editor' }).click()
  await expect(page.locator('.agent-editor')).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: 'Build NL' }).click()
  await expect(page.locator('.agent-nl-wizard')).toBeVisible()

  await page.locator('.agent-nl-wizard textarea').fill('Agent review code cho E2E test')
  await page.getByRole('button', { name: 'Generate draft' }).click()

  await expect(page.locator('.agent-nl-wizard')).toContainText('Kiểm tra và chỉnh sửa draft')
  await expect(page.locator('.agent-nl-wizard .cfg-input').first()).toHaveValue('e2e-wizard-agent')
  await expect(page.locator('.agent-nl-wizard .wizard-steps li.done')).toHaveCount(1)
  await expect(page.locator('.agent-nl-wizard .wizard-steps li.current')).toContainText('2. Xem lại draft')

  await capture(page, testInfo, 'agent-build-wizard-preview')
})
