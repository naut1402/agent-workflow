import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

// E2E capture for the features/pipeline-editor module. Switches to the Pipeline
// Editor mode and confirms the VueFlow canvas mounts (proves PipelineEditor +
// its sub-panels still wire up after the feature-module migration).

const EVIDENCE = path.resolve(process.cwd(), 'docs', 'features-pipeline-editor-evidence')

test('pipeline editor mode mounts the canvas (capture)', async ({ page }) => {
  fs.mkdirSync(EVIDENCE, { recursive: true })

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: 'Pipeline Editor' }).click()

  // VueFlow renders its pane once the resolved pipeline config loads.
  await expect(page.locator('.vue-flow')).toBeVisible({ timeout: 15_000 })

  await page.screenshot({ path: path.join(EVIDENCE, 'pipeline-editor.png'), fullPage: true })

  fs.writeFileSync(
    path.join(EVIDENCE, 'verify-results.json'),
    JSON.stringify(
      {
        feature: 'features-pipeline-editor',
        checks: [{ name: 'switch to Pipeline Editor mode → VueFlow canvas mounts', ok: true }],
        capturedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  )
})
