/**
 * Playwright verification for U0002 backlog fixes (issue #22).
 * Run: DEV_TEAM_ROOT=<path> node scripts/verify-backlog.mjs [baseUrl]
 */
import { chromium } from 'playwright'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(__dirname, '../docs/u0002-backlog-evidence')
const BASE = process.argv[2] || 'http://localhost:5199'

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`)
  await page.screenshot({ path: file, fullPage: false })
  console.log(`OK screenshot: ${name}`)
  return file
}

async function main() {
  await fs.mkdir(OUT, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

  const results = []

  try {
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 })

    // Open Pipeline Editor
    await page.getByRole('button', { name: 'Pipeline Editor' }).click()
    await page.waitForTimeout(500)

    // VĐ1: Per-task dropdown
    await page.locator('.scope-select').selectOption('task')
    await page.waitForTimeout(300)
    const taskSelect = page.locator('.editor-scope select.scope-select').nth(1)
    const taskOptions = await taskSelect.locator('option').allTextContents()
    const hasDropdown = taskOptions.some((t) => t.includes('U0002') || t.includes('F0000'))
    await shot(page, 'vd1-task-dropdown')
    results.push({ id: 'VĐ1', pass: hasDropdown && taskOptions.some((t) => t.includes('Nhập thủ công')), note: `options: ${taskOptions.join(', ')}` })

    // VĐ2: Select U0002 and verify canvas nodes load
    if (taskOptions.some((t) => t.includes('U0002'))) {
      await taskSelect.selectOption({ label: 'U0002' })
    } else {
      await taskSelect.selectOption('__manual__')
      await page.locator('.scope-task-input').fill('U0002')
    }
    await page.waitForTimeout(800)
    const nodeCount = await page.locator('.node-editor').count()
    await shot(page, 'vd2-auto-load-config')
    results.push({ id: 'VĐ2', pass: nodeCount >= 1, note: `nodes on canvas: ${nodeCount}` })

    // VĐ3: Agents tab with multi-source
    await page.getByRole('button', { name: 'Catalog' }).click()
    await page.waitForTimeout(200)
    const agentsTab = page.getByRole('button', { name: /Agents \(\d+\)/ })
    await agentsTab.click()
    await page.waitForTimeout(400)
    const agentBadges = await page.locator('.source-badge').allTextContents()
    const agentCount = await page.locator('.catalog-item').count()
    await shot(page, 'vd3-agents-multisource')
    results.push({
      id: 'VĐ3',
      pass: agentCount >= 6 && agentBadges.some((b) => /user|cursor|plugin|repo|project/.test(b)),
      note: `agents: ${agentCount}, badges sample: ${agentBadges.slice(0, 5).join(', ')}`,
    })

    // VĐ4: Skills tab with source filter
    await page.getByRole('button', { name: /Skills \(\d+\)/ }).click()
    await page.waitForTimeout(300)
    const skillCount = await page.locator('.catalog-item').count()
    const sourceFilter = page.locator('.catalog-source-filter')
    const hasFilter = await sourceFilter.count() > 0
    await sourceFilter.selectOption('user')
    await page.waitForTimeout(200)
    await shot(page, 'vd4-skills-multisource')
    results.push({ id: 'VĐ4', pass: skillCount >= 10 && hasFilter, note: `skills: ${skillCount}, source filter: ${hasFilter}` })

    // VĐ5: Rules panel
    await page.getByRole('button', { name: 'Rules' }).click()
    await page.waitForTimeout(500)
    const rulesCount = await page.locator('.rules-item').count()
    const hasStepsRef = (await page.locator('.rules-item-steps').allTextContents()).some(
      (t) => t.includes('→') || t.includes('không dùng'),
    )
    await shot(page, 'vd5-rules-panel')
    // Click first rule to test highlight
    if (rulesCount > 0) {
      await page.locator('.rules-item').first().click()
      await page.waitForTimeout(300)
      await shot(page, 'vd5-rules-highlight')
    }
    results.push({ id: 'VĐ5', pass: rulesCount >= 1 && hasStepsRef, note: `rules: ${rulesCount}` })

    // Monitor mode regression
    await page.getByRole('button', { name: 'Monitor' }).click()
    await page.waitForTimeout(800)
    await shot(page, 'monitor-mode-regression')
    results.push({ id: 'Monitor', pass: true, note: 'switched to monitor without error' })
  } catch (err) {
    console.error('FAIL', err)
    await shot(page, 'error-state').catch(() => {})
    results.push({ id: 'ERROR', pass: false, note: String(err.message || err) })
  } finally {
    await browser.close()
  }

  const summaryPath = path.join(OUT, 'verify-results.json')
  await fs.writeFile(summaryPath, JSON.stringify({ base: BASE, results }, null, 2))
  console.log(JSON.stringify(results, null, 2))
  const failed = results.filter((r) => !r.pass)
  process.exit(failed.length ? 1 : 0)
}

main()
