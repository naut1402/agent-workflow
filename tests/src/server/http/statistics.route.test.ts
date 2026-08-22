import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../../src/api/apiServer.js'
import { createRegistryContext } from '../../../../src/core/registry.js'
import { resetUsageStatsCacheForTest } from '../../../../src/features/statistics/business/usageStats.js'

let home: string
const savedHome = process.env.DEV_TEAM_DASHBOARD_HOME

const T0 = Date.parse('2026-08-01T10:00:00.000Z')

function usageEntry(p: { jobId: string; taskId: string; totalTokens: number; durationMs?: number }) {
  return JSON.stringify({
    type: 'usage',
    ts: T0,
    iso: new Date(T0).toISOString(),
    level: 'info',
    traceId: '',
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: p.totalTokens,
    estimatedCostUsd: null,
    model: null,
    provider: 'claude-code-cli',
    taskId: p.taskId,
    projectId: 'p1',
    stepId: 'implement',
    jobId: p.jobId,
    durationMs: p.durationMs ?? null,
  })
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'statistics-http-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  resetUsageStatsCacheForTest()
  fs.mkdirSync(path.join(home, 'logs'), { recursive: true })
  fs.writeFileSync(
    path.join(home, 'logs', 'usage.jsonl'),
    [
      usageEntry({ jobId: 'j1', taskId: 'TA', totalTokens: 100, durationMs: 1_000 }),
      usageEntry({ jobId: 'j1b', taskId: 'TA', totalTokens: 300, durationMs: 3_000 }),
      usageEntry({ jobId: 'j2', taskId: 'TB', totalTokens: 900 }),
    ].join('\n'),
  )
})

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true })
  if (savedHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = savedHome
  resetUsageStatsCacheForTest()
})

describe('HTTP GET /api/statistics/usage', () => {
  test('aggregate mặc định theo task, sort totalTokens desc', async () => {
    const app = await createApp(createRegistryContext({ defaultRoot: null }))
    const res = await app.request('/api/statistics/usage')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.groupBy).toBe('task')
    expect(body.groups.map((g: any) => g.key)).toEqual(['TB', 'TA'])
    expect(body.totals.totalTokens).toBe(1300)
    expect(body.truncated).toBe(false)
    const ta = body.groups[1]
    expect(ta.minTotalTokens).toBe(100)
    expect(ta.maxTotalTokens).toBe(300)
    expect(ta.avgTotalTokens).toBe(200)
    expect(ta.minDurationMs).toBe(1000)
    expect(ta.maxDurationMs).toBe(3000)
    expect(ta.avgDurationMs).toBe(2000)
  })

  test('lọc project + groupBy step + filter task', async () => {
    const app = await createApp(createRegistryContext({ defaultRoot: null }))
    const res = await app.request('/api/statistics/usage?project=p1&groupBy=step&task=TA')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.groups.map((g: any) => g.key)).toEqual(['implement'])
    expect(body.groups[0].totalTokens).toBe(400)
  })

  test('groupBy=date với from ISO hợp lệ', async () => {
    const app = await createApp(createRegistryContext({ defaultRoot: null }))
    const res = await app.request('/api/statistics/usage?groupBy=date&from=2026-08-01T00:00:00Z')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.groups.map((g: any) => g.key)).toEqual(['2026-08-01'])
  })

  test('groupBy không hợp lệ → 400', async () => {
    const app = await createApp(createRegistryContext({ defaultRoot: null }))
    const res = await app.request('/api/statistics/usage?groupBy=bogus')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid usage stats query' })
  })

  test('from không parse được → 400', async () => {
    const app = await createApp(createRegistryContext({ defaultRoot: null }))
    const res = await app.request('/api/statistics/usage?from=not-a-date')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid from' })
  })
})
