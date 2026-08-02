import type { Page, TestInfo } from '@playwright/test'

/** Screenshot vào output gitignored rồi attach vào playwright-report (không ghi docs/). */
export async function capturePage(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const file = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  await testInfo.attach(name, { path: file, contentType: 'image/png' })
}

/** Alias giữ tương thích các spec release (settings / quick-action / archive…). */
export const capture = capturePage
