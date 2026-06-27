/**
 * Playwright verification for U0002 UX improvements (issue #22, vòng 2).
 * Run: node scripts/verify-ux.mjs [baseUrl]
 */
import { chromium } from 'playwright'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(__dirname, '../docs/u0002-ux-evidence')
const BASE = process.argv[2] || 'http://localhost:5173'

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
    await page.getByRole('button', { name: 'Pipeline Editor' }).click()
    await page.waitForTimeout(800)

    // UX2: No config panel without selection (run before any node click)
    const configCount = await page.locator('.step-config-panel').count()
    await shot(page, 'ux2-no-config-panel')
    results.push({
      id: 'UX2',
      pass: configCount === 0,
      note: `step-config-panel count: ${configCount}`,
    })

    // UX3: Drop agent onto canvas
    await page.locator('.catalog-tab', { hasText: 'Agents' }).click()
    await page.waitForTimeout(300)
    const nodesBefore = await page.locator('.vue-flow__node').count()
    await page.locator('.catalog-item').first().dragTo(page.locator('.editor-canvas'), {
      targetPosition: { x: 420, y: 280 },
    })
    await page.waitForTimeout(600)
    const nodesAfter = await page.locator('.vue-flow__node').count()
    const dropInfo = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('.vue-flow__node')]
      const last = nodes[nodes.length - 1]
      if (!last) return { ok: false }
      const tr = last.style.transform
      const m = tr.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/)
      if (!m) return { ok: nodes.length > 0, tr }
      return { ok: parseFloat(m[1]) > 80 || parseFloat(m[2]) > 80, nodeX: parseFloat(m[1]), nodeY: parseFloat(m[2]) }
    })
    await shot(page, 'ux3-drop-position')
    results.push({
      id: 'UX3',
      pass: nodesAfter > nodesBefore && dropInfo.ok !== false,
      note: `nodes ${nodesBefore}→${nodesAfter}, ${JSON.stringify(dropInfo)}`,
    })

    // UX4: Preview status badges + banner
    await page.getByRole('button', { name: '▶ Preview' }).click()
    await page.waitForTimeout(800)
    const badgeVisible = (await page.locator('.preview-status').count()) > 0
    const bannerText = (await page.locator('.preview-banner').textContent()) || ''
    const hasStepInBanner = /\d+\/\d+/.test(bannerText)
    await shot(page, 'ux4-preview-status')
    await page.getByRole('button', { name: '■ Stop' }).click().catch(() => {})
    await page.waitForTimeout(300)
    results.push({
      id: 'UX4',
      pass: badgeVisible && hasStepInBanner,
      note: `badges=${badgeVisible}, banner="${bannerText.trim().slice(0, 80)}"`,
    })

    // UX1a: App sidebar collapse
    const sidebar = page.locator('.sidebar')
    const widthBefore = await sidebar.evaluate((el) => el.getBoundingClientRect().width)
    await page.locator('.sidebar-toggle').click()
    await page.waitForTimeout(300)
    const collapsed = await sidebar.evaluate((el) => el.classList.contains('sidebar-collapsed'))
    const widthAfter = await sidebar.evaluate((el) => el.getBoundingClientRect().width)
    await shot(page, 'ux1a-app-sidebar-collapsed')
    results.push({
      id: 'UX1a',
      pass: collapsed && widthAfter < widthBefore - 50,
      note: `width ${Math.round(widthBefore)} → ${Math.round(widthAfter)}, re-open=${widthAfter > 50}`,
    })

    // UX1a-reopen: toggle back open
    await page.locator('.sidebar-toggle').click()
    await page.waitForTimeout(200)
    const reopened = await sidebar.evaluate((el) => !el.classList.contains('sidebar-collapsed'))
    results.push({
      id: 'UX1a-reopen',
      pass: reopened,
      note: `sidebar expanded again=${reopened}`,
    })

    // UX1b: Editor left collapse (already in editor mode; expand app sidebar if needed)
    if (collapsed) {
      await page.locator('.sidebar-toggle').click()
      await page.waitForTimeout(200)
    }
    await page.locator('.editor-left-collapse-btn').click()
    await page.waitForTimeout(300)
    const editorLeftCollapsed = await page.locator('.editor-left').evaluate(
      (el) => el.classList.contains('editor-left-collapsed'),
    )
    await shot(page, 'ux1b-editor-left-collapsed')
    results.push({
      id: 'UX1b',
      pass: editorLeftCollapsed,
      note: `editor-left-collapsed=${editorLeftCollapsed}`,
    })

    // UX1b-reopen via collapse button
    await page.locator('.editor-left-collapse-btn').click()
    await page.waitForTimeout(200)
    const editorReopened = await page.locator('.editor-left').evaluate(
      (el) => !el.classList.contains('editor-left-collapsed'),
    )
    results.push({
      id: 'UX1b-reopen',
      pass: editorReopened,
      note: `editor-left expanded again=${editorReopened}`,
    })

    // REG: Monitor mode
    await page.locator('.mode-toggle .mode-btn').first().click()
    await page.waitForTimeout(800)
    await shot(page, 'reg-monitor-mode')
    results.push({ id: 'REG', pass: true, note: 'switched to monitor' })
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
