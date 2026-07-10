import { test, expect } from '@playwright/test'
import { capture } from './_capture'

// E2E capture for AgentBuildWizard (Feature 2 / U0005-3): monitor toolbar →
// describe NL → preview draft. Generate is mocked so the spec stays deterministic
// without ANTHROPIC_API_KEY or a live runner.

test('agent build wizard: describe → preview (capture)', async ({ page }, testInfo) => {
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

  await page.getByRole('button', { name: '⚡ Tạo agent' }).click()
  await expect(page.locator('.agent-build-wizard')).toBeVisible({ timeout: 15_000 })

  await page.locator('.agent-build-wizard textarea').fill('Agent review code cho E2E test')
  await page.getByRole('button', { name: 'Tạo draft →' }).click()

  await expect(page.locator('.agent-build-wizard')).toContainText('Kiểm tra và chỉnh sửa draft')
  await expect(page.locator('.agent-build-wizard .field-input').first()).toHaveValue('e2e-wizard-agent')
  await expect(page.locator('.wizard-steps li.done')).toHaveCount(1)
  await expect(page.locator('.wizard-steps li.current')).toContainText('2. Xem lại draft')

  await capture(page, testInfo, 'agent-build-wizard-preview')
})
