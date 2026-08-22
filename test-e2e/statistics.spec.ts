import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { capturePage } from './_capture'

// E2E cho mode Thống kê (issue #231). Boot standalone server theo playwright.config
// (fixture .dev-team-agent + DEV_TEAM_DASHBOARD_HOME isolate). Seed vài dòng
// usage.jsonl vào home e2e để chart + bảng render có dữ liệu deterministic.
// Renderer: chart.js (canvas) — assert canvas + height style thay vì mermaid svg.

const e2eHome = path.resolve(process.cwd(), 'test-e2e/.runtime/home')

function usageLine(p: { projectId: string; taskId: string; stepId: string; jobId: string; ts: number; total: number }) {
  return JSON.stringify({
    type: 'usage',
    ts: p.ts,
    iso: new Date(p.ts).toISOString(),
    level: 'info',
    traceId: '',
    inputTokens: Math.round(p.total * 0.6),
    outputTokens: Math.round(p.total * 0.4),
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: p.total,
    estimatedCostUsd: null,
    model: 'claude-sonnet',
    provider: 'claude-code-cli',
    taskId: p.taskId,
    projectId: p.projectId,
    stepId: p.stepId,
    jobId: p.jobId,
    durationMs: 60_000,
    source: 'main',
  })
}

test('statistics mode: gallery đa chart + settings + resize (capture)', async ({ page, request }, testInfo) => {
  // Lấy default project id của registry e2e để seed usage đúng scope mặc định.
  const projectsRes = await request.get('/api/projects')
  const projectsBody = (await projectsRes.json()) as { defaultId?: string | null }
  const projectId = projectsBody.defaultId || ''

  const now = Date.now()
  const lines = [
    usageLine({ projectId, taskId: 'STAT-1', stepId: 'implement', jobId: '11111111-2222-4333-8444-555555555555', ts: now - 3_600_000, total: 12_000 }),
    usageLine({ projectId, taskId: 'STAT-1', stepId: 'review', jobId: '22222222-2222-4333-8444-555555555555', ts: now - 1_800_000, total: 8_000 }),
    usageLine({ projectId, taskId: 'STAT-2', stepId: 'implement', jobId: '33333333-2222-4333-8444-555555555555', ts: now - 900_000, total: 5_000 }),
  ]
  const logsDir = path.join(e2eHome, 'logs')
  fs.mkdirSync(logsDir, { recursive: true })
  fs.writeFileSync(path.join(logsDir, 'usage.jsonl'), `${lines.join('\n')}\n`)

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await page.locator('button[title="Thống kê"]').click()
  await expect(page.locator('.statistics-panel')).toBeVisible({ timeout: 15_000 })

  // Bảng tổng hợp theo task mặc định: STAT-1 (20K) trước STAT-2 (5K).
  await expect(page.locator('.statistics-table tbody tr')).toHaveCount(2, { timeout: 10_000 })
  await expect(page.locator('.statistics-table tbody tr').first()).toContainText('STAT-1')

  // Card summary dạng table: min/max/avg theo entry + dimension + step.
  const summaryCard = page.locator('.statistics-summary-card')
  await expect(summaryCard).toBeVisible()
  await expect(summaryCard.locator('.summary-table')).toBeVisible()
  await expect(summaryCard).toContainText('Tổng token mỗi step')
  await expect(summaryCard).toContainText('Chỉ số (tokens)')

  // chart.js vẽ canvas trong card — chart.js vẽ có dữ liệu thì canvas có kích thước thật.
  const canvas = page.locator('.chart-card-body canvas').first()
  await expect(canvas).toBeVisible({ timeout: 15_000 })
  await expect
    .poll(async () => {
      const box = await canvas.boundingBox()
      return box ? Math.round(box.height) : 0
    })
    .toBeGreaterThan(100)

  // Action group MỘT cụm cố định GÓC TRÊN BÊN PHẢI: ẩn mặc định, hover chart
  // thì hiện. Nhóm chứa settings/remove/zoom.
  const tile = page.locator('.chart-tile').first()
  const actions = tile.locator('.chart-tile-actions')
  await expect(actions).toHaveCSS('opacity', '0')
  const tileBox = (await tile.boundingBox())!
  await page.mouse.move(tileBox.x + tileBox.width * 0.5, tileBox.y + 60)
  await expect(actions).toHaveCSS('opacity', '1')
  // Group neo góc trên-phải: không đổi vị trí khi con trỏ di chuyển trong tile.
  const pos1 = await actions.evaluate((el) => `${el.style.top}|${el.style.right}`)
  await page.mouse.move(tileBox.x + tileBox.width * 0.2, tileBox.y + 150)
  const pos2 = await actions.evaluate((el) => `${el.style.top}|${el.style.right}`)
  expect(pos1).toBe(pos2)
  await expect(tile.locator('button[title="Phóng to"]')).toBeVisible()
  await page.mouse.move(tileBox.x - 40, tileBox.y - 40)
  await expect(actions).toHaveCSS('opacity', '0')

  // Zoom: click phóng to → nội dung scale 1.25 (computed transform = matrix).
  await page.mouse.move(tileBox.x + 80, tileBox.y + 60)
  await tile.locator('button[title="Phóng to"]').click()
  await expect(tile.locator('.chart-tile-zoom')).toHaveCSS('transform', /1\.25/)
  await tile.locator('button[title="Về kích thước gốc"]').click()
  await expect(tile.locator('.chart-tile-zoom')).not.toHaveCSS('transform', /1\.25/)

  // Loại biểu đồ nằm trong dialog settings của từng chart (selects: kind,
  // groupBy, metric, chartType, numberFormat → chartType index 3).
  async function setChartType(label: string) {
    const t = page.locator('.chart-tile').first()
    const tb = (await t.boundingBox())!
    await page.mouse.move(tb.x + 60, tb.y + 50) // action group hiện khi hover
    await t.locator('button[title="Thiết lập biểu đồ"]').click()
    const dialog = page.locator('.chart-settings-dialog')
    await expect(dialog).toBeVisible()
    await dialog.locator('.c-select-trigger').nth(3).click()
    await page.locator('.c-select-option', { hasText: label }).first().click()
    await dialog.locator('.chart-settings-close').click()
    await expect(dialog).toHaveCount(0)
  }
  await setChartType('Đường')
  await expect(page.locator('.chart-card-body canvas').first()).toBeVisible()
  await setChartType('Tròn')
  await expect(page.locator('.chart-card-body canvas').first()).toBeVisible()
  await setChartType('Cột')
  await expect(page.locator('.chart-card-body canvas').first()).toBeVisible()

  // Hai pie cùng lúc không vẽ chồng nhau (bug mermaid đa instance): thêm chart
  // thứ 2 qua menu +, đặt cả hai thành pie — mỗi tile phải có canvas riêng.
  await page.locator('.statistics-add-chart').click()
  await page.locator('.statistics-add-menu button', { hasText: 'Biểu đồ' }).click()
  await expect(page.locator('.chart-tile')).toHaveCount(2)
  const addDialog = page.locator('.chart-settings-dialog')
  await expect(addDialog).toBeVisible()
  await addDialog.locator('.chart-settings-close').click()
  await setChartType('Tròn')
  for (const c of await page.locator('.chart-card-body canvas').all()) {
    await expect(c).toBeVisible()
  }
  await page.locator('.chart-tile').nth(1).locator('button[title="Bỏ chart này"]').click()
  await expect(page.locator('.chart-tile')).toHaveCount(1)

  // Kéo handle góc tile: dọc +40px → height snap 340; ngang đủ xa → snap span 4.
  const handle = page.locator('.chart-resize-handle')
  const handleBox = await handle.boundingBox()
  expect(handleBox).toBeTruthy()
  await page.mouse.move(handleBox!.x + 7, handleBox!.y + 7)
  await page.mouse.down()
  await page.mouse.move(handleBox!.x + 7 + 900, handleBox!.y + 7 + 40, { steps: 5 })
  await page.mouse.up()
  await expect
    .poll(() => page.locator('.chart-card-body').first().evaluate((el) => el.style.height))
    .toBe('340px')
  const spanNow = await page.locator('.chart-tile').first().evaluate((el) => el.style.gridColumn)
  expect(spanNow).toContain('span 4')

  // Dialog thiết lập: mở, sửa tiêu đề (live-apply), đóng.
  const tb2 = (await page.locator('.chart-tile').first().boundingBox())!
  await page.mouse.move(tb2.x + 60, tb2.y + 50)
  await page.locator('.chart-tile button[title="Thiết lập biểu đồ"]').first().click()
  await expect(page.locator('.chart-settings-dialog')).toBeVisible()
  await page.locator('.chart-settings-dialog input[type="text"]').first().fill('Tiêu đề tùy chỉnh')
  await page.locator('.chart-settings-close').click()
  await expect(page.locator('.chart-settings-dialog')).toHaveCount(0)

  // Drill-down: click task STAT-1 → groupBy step, breadcrumb hiện.
  await page.locator('.statistics-table tbody tr').first().click()
  await expect(page.locator('.statistics-crumb')).toContainText('STAT-1')
  await expect(page.locator('.statistics-table tbody tr')).toHaveCount(2, { timeout: 10_000 })

  // Toàn page thống kê scroll được — shell `.main-editor` overflow:hidden nên
  // chính `.statistics-panel` phải là scroll container (viewport 720px cao).
  const panel = page.locator('.statistics-panel')
  const scrollable = await panel.evaluate((el) => el.scrollHeight > el.clientHeight)
  expect(scrollable).toBe(true)
  await panel.evaluate((el) => el.scrollTo(0, el.scrollHeight))
  expect(await panel.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)

  await capturePage(page, testInfo, 'statistics')
})
