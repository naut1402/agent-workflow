/**
 * Playwright verification for U0002-B01 (issue #22 VĐ5 + VĐ6).
 * Run: node scripts/verify-profile-reload.mjs [baseUrl]
 */
import { chromium } from 'playwright'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(__dirname, '../docs/u0002-b01-evidence')
const BASE = process.argv[2] || 'http://localhost:5173'
const PROFILE_NAME = 'u0002-b01-test'

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`)
  await page.screenshot({ path: file, fullPage: false })
  console.log(`OK screenshot: ${name}`)
}

async function deleteAllNodes(page) {
  for (let i = 0; i < 30; i++) {
    const del = page.locator('.node-btn-del')
    if ((await del.count()) === 0) break
    await del.first().click({ force: true })
    await page.waitForTimeout(150)
  }
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

    const initialCount = await page.locator('.vue-flow__node').count()

    await deleteAllNodes(page)
    await page.waitForTimeout(300)
    const afterDelete = await page.locator('.vue-flow__node').count()

    await page.locator('.catalog-tab', { hasText: 'Agents' }).click()
    await page.waitForTimeout(300)
    await page.locator('.catalog-item').first().dragTo(page.locator('.editor-canvas'), {
      targetPosition: { x: 400, y: 280 },
    })
    await page.waitForTimeout(600)
    const afterOneDrop = await page.locator('.vue-flow__node').count()

    await page.locator('.profile-input').fill(PROFILE_NAME)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.waitForTimeout(600)

    await page.locator('.catalog-item').nth(1).dragTo(page.locator('.editor-canvas'), {
      targetPosition: { x: 600, y: 280 },
    })
    await page.waitForTimeout(600)
    const beforeLoad = await page.locator('.vue-flow__node').count()

    await page.locator('.profile-select').selectOption(PROFILE_NAME)
    await page.getByRole('button', { name: 'Load' }).click()
    await page.waitForTimeout(600)
    const afterLoad = await page.locator('.vue-flow__node').count()

    await shot(page, 'vd5-profile-reload')
    results.push({
      id: 'VD5',
      pass: afterLoad === 1 && afterOneDrop === 1,
      note: `initial=${initialCount}, afterDelete=${afterDelete}, oneDrop=${afterOneDrop}, beforeLoad=${beforeLoad}, afterLoad=${afterLoad}`,
    })

    // VĐ6: fan-out warning banner when multiple edges from one source
    await deleteAllNodes(page)
    await page.waitForTimeout(300)
    const items = page.locator('.catalog-item')
    const itemCount = await items.count()
    if (itemCount >= 3) {
      await items.nth(0).dragTo(page.locator('.editor-canvas'), { targetPosition: { x: 200, y: 280 } })
      await page.waitForTimeout(400)
      await items.nth(1).dragTo(page.locator('.editor-canvas'), { targetPosition: { x: 450, y: 200 } })
      await page.waitForTimeout(400)
      await items.nth(2).dragTo(page.locator('.editor-canvas'), { targetPosition: { x: 450, y: 360 } })
      await page.waitForTimeout(500)

      const nodeIds = await page.evaluate(() => {
        const nodes = [...document.querySelectorAll('.vue-flow__node')]
        return nodes.map((n) => n.getAttribute('data-id'))
      })

      if (nodeIds.length >= 3) {
        const source = nodeIds[0]
        const t1 = nodeIds[1]
        const t2 = nodeIds[2]
        await page.evaluate(({ source, t1, t2 }) => {
          const handles = document.querySelectorAll('.vue-flow__handle')
          const right = [...handles].filter((h) => h.classList.contains('source'))
          const left = [...handles].filter((h) => h.classList.contains('target'))
          if (right.length && left.length >= 2) {
            right[0]?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
          }
        }, { source, t1, t2 })
      }

      // Connect via vue-flow: click source handle then targets — use connect handles if visible
      const sourceHandle = page.locator(`[data-id="${nodeIds[0]}"] .vue-flow__handle.source`).first()
      const target1 = page.locator(`[data-id="${nodeIds[1]}"] .vue-flow__handle.target`).first()
      const target2 = page.locator(`[data-id="${nodeIds[2]}"] .vue-flow__handle.target`).first()

      if (await sourceHandle.count() && await target1.count() && await target2.count()) {
        await sourceHandle.dragTo(target1)
        await page.waitForTimeout(300)
        await sourceHandle.dragTo(target2)
        await page.waitForTimeout(400)
      }

      const fanoutVisible = (await page.locator('.fanout-warning').count()) > 0
      await shot(page, 'vd6-fanout-warning')
      results.push({
        id: 'VD6',
        pass: fanoutVisible,
        note: `fanout-warning visible=${fanoutVisible}`,
      })
    } else {
      results.push({ id: 'VD6', pass: false, note: 'not enough catalog agents for fan-out test' })
    }

    // Per-task: U0001-T1 has 2 steps only (not merged with global default)
    const sidebar = page.locator('.sidebar')
    if (await sidebar.evaluate((el) => el.classList.contains('sidebar-collapsed'))) {
      await page.locator('.sidebar-toggle').click()
      await page.waitForTimeout(300)
    }
    await page.locator('.scope-select').first().selectOption('task')
    await page.waitForTimeout(200)
    await page.locator('.scope-select').nth(1).selectOption('U0001-T1')
    await page.waitForTimeout(800)
    const taskNodes = await page.locator('.vue-flow__node').count()
    await shot(page, 'per-task-u0001-t1')
    results.push({
      id: 'VD5-task',
      pass: taskNodes === 2,
      note: `U0001-T1 nodes on canvas: ${taskNodes} (expected 2)`,
    })
  } catch (err) {
    console.error('FAIL', err)
    await shot(page, 'error-state').catch(() => {})
    results.push({ id: 'ERROR', pass: false, note: String(err.message || err) })
  } finally {
    await browser.close()
  }

  const summary = { base: BASE, results, pass: results.every((r) => r.pass) }
  await fs.writeFile(path.join(OUT, 'verify-results.json'), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(results, null, 2))
  process.exit(summary.pass ? 0 : 1)
}

main()
