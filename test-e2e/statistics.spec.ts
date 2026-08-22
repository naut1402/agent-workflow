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

test('statistics mode: chart mermaid + bảng drill-down (capture)', async ({ page, request }, testInfo) => {
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
    const mermaidNode = page.locator('.chart-card-body .mermaid')
    await expect(mermaidNode.locator('svg')).toBeVisible({ timeout: 20_000 })
    await expect(mermaidNode).not.toContainText(/syntax error/i)
  }
  await expectChartRendered()

  // Đổi loại chart (bar → line → pie) qua selectbox trong slot control của card.
  async function pickChartType(label: string) {
    await page.locator('.chart-card-controls .c-select-trigger').nth(1).click()
    await page.locator('.c-select-option', { hasText: label }).click()
  }
  await pickChartType('Đường')
  await expectChartRendered()
  await pickChartType('Tròn')
  await expectChartRendered()

  // Drill-down: click task STAT-1 → groupBy step, breadcrumb hiện.
  await page.locator('.statistics-table tbody tr').first().click()
  await expect(page.locator('.statistics-crumb')).toContainText('STAT-1')
  await expect(page.locator('.statistics-table tbody tr')).toHaveCount(2, { timeout: 10_000 })
  await expectChartRendered()

  await capturePage(page, testInfo, 'statistics')
})
