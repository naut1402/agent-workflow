import type { Page, TestInfo } from '@playwright/test'

// Capture an e2e screenshot as a test ATTACHMENT (lands in playwright-report →
// CI artifact `test-evidence` → attach into the PR result comment). Never writes
// into docs/ — see AGENTS.md (mục Doc output / Evidence).
export async function capture(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const file = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  await testInfo.attach(name, { path: file, contentType: 'image/png' })
}
