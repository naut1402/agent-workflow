/**
 * Playwright verification for U0002-01 Agent Editor (issue #25).
 * Run: node scripts/verify-agent-editor.mjs [baseUrl]
 */
import { chromium } from 'playwright'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(__dirname, '../docs/u0002-01-agent-editor-evidence')
const BASE = process.argv[2] || 'http://localhost:5173'

async function main() {
  await fs.mkdir(OUT, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const results = []

  try {
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 })
    await page.getByRole('button', { name: 'Agent Editor' }).click()
    await page.waitForTimeout(600)

    const hasEditor = await page.locator('.agent-editor').count()
    results.push({ id: 'M1-mode', pass: hasEditor > 0, note: `agent-editor: ${hasEditor}` })

    await page.getByRole('button', { name: '+ New' }).click()
    await page.locator('.agent-basic-fields input').first().fill('verify-test-agent')
    await page.getByRole('button', { name: 'Lưu' }).click()
    await page.waitForTimeout(800)

    const saved = await page.locator('.agent-list-item', { hasText: 'verify-test-agent' }).count()
    results.push({ id: 'M1-save', pass: saved > 0, note: `saved agent visible: ${saved}` })

    await page.getByRole('button', { name: 'Template / Copy' }).click()
    await page.waitForTimeout(400)
    const tpl = await page.locator('.agent-template-picker').count()
    results.push({ id: 'M2-template', pass: tpl > 0, note: `template picker: ${tpl}` })
    await page.getByRole('button', { name: 'Đóng' }).click()

    await page.getByRole('button', { name: 'Build NL' }).click()
    await page.waitForTimeout(300)
    const nl = await page.locator('.agent-nl-wizard').count()
    results.push({ id: 'M5-nl', pass: nl > 0, note: `nl wizard: ${nl}` })

    await fs.writeFile(
      path.join(OUT, 'verify-results.json'),
      JSON.stringify({ base: BASE, results, pass: results.every((r) => r.pass) }, null, 2),
    )
    console.log(JSON.stringify(results, null, 2))
    const failed = results.filter((r) => !r.pass)
    if (failed.length) process.exitCode = 1
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
