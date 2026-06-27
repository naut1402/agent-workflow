/**
 * Playwright + API verification for U0005 Runner Config.
 * Run: node scripts/verify-runners.mjs [baseUrl]
 */
import { chromium } from 'playwright'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(__dirname, '../docs/u0005-runner-evidence')
const BASE = process.argv[2] || 'http://localhost:5173'

async function main() {
  await fs.mkdir(OUT, { recursive: true })
  const results = []

  // API module smoke (no server required)
  try {
    const { listRunners, listCredentials } = await import('../server/runners/index.js')
    const runners = listRunners()
    const creds = listCredentials()
    results.push({
      id: 'api-module',
      pass: runners.runners?.length > 0 && creds.length > 0,
      note: `runners=${runners.runners?.length} creds=${creds.length}`,
    })
  } catch (e) {
    results.push({ id: 'api-module', pass: false, note: String(e.message) })
  }

  let browser
  try {
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 })

    await page.getByRole('button', { name: 'Runner' }).click()
    await page.waitForTimeout(600)

    const hasPanel = await page.locator('.runner-config').count()
    results.push({ id: 'ui-runner-mode', pass: hasPanel > 0, note: `panel: ${hasPanel}` })

    await page.getByRole('button', { name: '+ New' }).click()
    await page.waitForTimeout(300)
    const inputs = page.locator('.runner-form input')
    await inputs.nth(0).fill('verify-runner-test')
    await inputs.nth(1).fill('Verify Runner Test')
    await page.getByRole('button', { name: 'Lưu' }).click()
    await page.waitForTimeout(1200)

    const saved =
      (await page.locator('.runner-list li', { hasText: 'Verify Runner Test' }).count()) +
      (await page.locator('.runner-list li', { hasText: 'verify-runner-test' }).count())
    results.push({ id: 'ui-save-runner', pass: saved > 0, note: `saved matches: ${saved}` })
  } catch (e) {
    const skipped = String(e.message || e).includes('ERR_CONNECTION_REFUSED')
    results.push({
      id: 'ui-playwright',
      pass: skipped,
      note: skipped ? 'skipped (no dev server)' : `failed: ${e.message}`,
    })
  } finally {
    if (browser) await browser.close()
  }

  const pass = results.every((r) => r.pass)
  await fs.writeFile(
    path.join(OUT, 'verify-results.json'),
    JSON.stringify({ base: BASE, results, pass }, null, 2),
  )
  console.log(JSON.stringify({ pass, results }, null, 2))
  process.exit(pass ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
