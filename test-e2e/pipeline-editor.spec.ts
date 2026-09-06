import { test, expect } from '@playwright/test'
import { capturePage } from './_capture'

// E2E capture for the features/pipeline-editor module. Switches to the Pipeline
// Editor mode and confirms the VueFlow canvas mounts (proves PipelineEditor +
// its sub-panels still wire up after the feature-module migration).

test('pipeline editor mode mounts the canvas (capture)', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: 'Pipeline Editor' }).click()

  // VueFlow renders its pane once the resolved pipeline config loads.
  await expect(page.locator('.vue-flow')).toBeVisible({ timeout: 15_000 })

  // 1.3 — top bar giờ chỉ còn 2 nút tab Task / Profile; mọi action nằm ở sub-sidebar.
  await expect(page.locator('.editor-toolbar .editor-tab')).toHaveCount(2)
  await expect(page.locator('.editor-target-panel')).toBeVisible()

  // c.1 — Agents / Skills / Rules là 3 mục collapsible cùng cấp, không còn card Catalog.
  await expect(page.locator('.editor-left-sections .editor-section')).toHaveCount(3)
  expect(await page.locator('.catalog-tabs').count()).toBe(0)

  // UX2 (ported from verify-ux): no step-config panel until a node is selected.
  expect(await page.locator('.step-config-panel').count()).toBe(0)

  await capturePage(page, testInfo, 'pipeline-editor')
})
