import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { capturePage } from './_capture'

// E2E cho mode Thống kê (issue #231). Boot standalone server theo playwright.config
// (fixture .dev-team-agent + DEV_TEAM_DASHBOARD_HOME isolate). Seed vài dòng
// usage.jsonl vào home e2e để chart + bảng render có dữ liệu deterministic.

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

test('statistics mode: đa chart + settings + resize (capture)', async ({ page, request }, testInfo) => {
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

  // ChartCard vẽ mermaid SVG qua markdown pipeline — parse lỗi vẫn sinh SVG
  // (error bomb) nên phải assert cả không có "Syntax error".
  async function expectChartRendered() {
    const mermaidNode = page.locator('.chart-card-body .mermaid').first()
    await expect(mermaidNode.locator('svg')).toBeVisible({ timeout: 20_000 })
    await expect(mermaidNode).not.toContainText(/syntax error/i)
  }
  await expectChartRendered()

  // Kích thước mặc định áp qua directive config — mermaid dựng viewBox theo
  // width/height config (svg width attr luôn "100%", max-width giới hạn theo px).
  const svgSize = () =>
    page.locator('.chart-card-body .mermaid svg').first().evaluate((el) => el.getAttribute('viewBox') || '')
  await expect.poll(svgSize, { timeout: 15_000 }).toBe('0 0 720 300')

  // Loại biểu đồ giờ nằm trong dialog settings của từng chart.
  async function setChartType(label: string) {
    await page.locator('.statistics-chart-item .icon-btn').first().click() // gear
    const dialog = page.locator('.chart-settings-dialog')
    await expect(dialog).toBeVisible()
    await dialog.locator('.c-select-trigger').nth(2).click() // groupBy, metric, chartType
    await page.locator('.c-select-option', { hasText: label }).first().click()
    await dialog.locator('.chart-settings-close').click()
    await expect(dialog).toHaveCount(0)
  }
  await setChartType('Đường')
  await expectChartRendered()
  await setChartType('Tròn')
  await expectChartRendered()
  await setChartType('Cột')
  await expectChartRendered()

  // Định dạng số: chuyển sang đầy đủ — tổng 25K hiện "25,000".
  await page.locator('.statistics-field .c-select-trigger').nth(1).click()
  await page.locator('.c-select-option', { hasText: 'Đầy đủ' }).click()
  await expect(page.locator('.statistics-summary')).toContainText('25,000')

  // Thêm chart mới → 2 card, dialog mở sẵn cho chart mới → đóng.
  await page.locator('.statistics-add-chart').click()
  await expect(page.locator('.statistics-chart-item')).toHaveCount(2)
  const addDialog = page.locator('.chart-settings-dialog')
  await expect(addDialog).toBeVisible()
  await addDialog.locator('.chart-settings-close').click()

  // Xoá 1 chart → còn 1 (nút xoá chỉ hiện khi có nhiều chart).
  await page.locator('.statistics-chart-item').nth(1).locator('button[title="Bỏ chart này"]').click()
  await expect(page.locator('.statistics-chart-item')).toHaveCount(1)

  // Kéo handle góc chart → kích thước mới áp vào viewBox (re-render một lần khi thả).
  const handle = page.locator('.chart-resize-handle')
  const handleBox = await handle.boundingBox()
  expect(handleBox).toBeTruthy()
  await page.mouse.move(handleBox!.x + 7, handleBox!.y + 7)
  await page.mouse.down()
  await page.mouse.move(handleBox!.x + 7 + 130, handleBox!.y + 7 + 40, { steps: 4 })
  await page.mouse.up()
  await expect.poll(svgSize, { timeout: 15_000 }).toBe('0 0 850 340')

  // Dialog thiết lập: mở, sửa tiêu đề (live-apply), đóng.
  await page.locator('.statistics-chart-item .icon-btn').first().click()
  await expect(page.locator('.chart-settings-dialog')).toBeVisible()
  await page.locator('.chart-settings-dialog input[type="text"]').first().fill('Tiêu đề tùy chỉnh')
  await expect(page.locator('.chart-card-body .mermaid')).not.toContainText(/syntax error/i)
  await page.locator('.chart-settings-close').click()
  await expect(page.locator('.chart-settings-dialog')).toHaveCount(0)

  // Drill-down: click task STAT-1 → groupBy step, breadcrumb hiện.
  await page.locator('.statistics-table tbody tr').first().click()
  await expect(page.locator('.statistics-crumb')).toContainText('STAT-1')
  await expect(page.locator('.statistics-table tbody tr')).toHaveCount(2, { timeout: 10_000 })
  await expectChartRendered()

  // Toàn page thống kê scroll được — shell `.main-editor` overflow:hidden nên
  // chính `.statistics-panel` phải là scroll container (viewport 720px cao).
  const panel = page.locator('.statistics-panel')
  const scrollable = await panel.evaluate((el) => el.scrollHeight > el.clientHeight)
  expect(scrollable).toBe(true)
  await panel.evaluate((el) => el.scrollTo(0, el.scrollHeight))
  expect(await panel.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)

  await capturePage(page, testInfo, 'statistics')
})
