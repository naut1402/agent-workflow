import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

// E2E capture for the features/agent-editor module. Switches to the Agent
// Editor mode and confirms the editor shell mounts (AgentEditor + sub-panels
// still wire up after the feature-module migration).

const EVIDENCE = path.resolve(process.cwd(), 'docs', 'features-agent-editor-evidence')

test('agent editor mode mounts (capture)', async ({ page }) => {
  fs.mkdirSync(EVIDENCE, { recursive: true })

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: 'Agent Editor' }).click()

  await expect(page.locator('.agent-editor')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Custom Agents')).toBeVisible()

  await page.screenshot({ path: path.join(EVIDENCE, 'agent-editor.png'), fullPage: true })

  fs.writeFileSync(
    path.join(EVIDENCE, 'verify-results.json'),
    JSON.stringify(
      {
        feature: 'features-agent-editor',
        checks: [{ name: 'switch to Agent Editor mode → editor shell mounts', ok: true }],
        capturedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  )
})
