import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../../src/backend/apiServer.js'
import { createRegistryContext } from '../../../../src/backend/registry.js'
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

  // ── #508: chuyển sang @Controller + UsageStatsRequest — hành vi giữ nguyên văn ──

  test('to không parse được → 400 invalid to (from hợp lệ vẫn chạy trước)', async () => {
    const app = await createApp(createRegistryContext({ defaultRoot: null }))
    const res = await app.request('/api/statistics/usage?from=2026-08-01&to=nope')
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ error: 'invalid to' })
  })

  test('from và to cùng hỏng → báo from trước', async () => {
    const app = await createApp(createRegistryContext({ defaultRoot: null }))
    const res = await app.request('/api/statistics/usage?from=x&to=y')
    expect(await res.json()).toEqual({ error: 'invalid from' })
  })

  test('schema fail ưu tiên hơn from/to (ký tự cấm trong task)', async () => {
    const app = await createApp(createRegistryContext({ defaultRoot: null }))
    const res = await app.request('/api/statistics/usage?task=a%2Fb&from=x')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid usage stats query' })
  })

  test('tham số rỗng coi như không gửi (task=&groupBy= → mặc định task, không lọc)', async () => {
    const app = await createApp(createRegistryContext({ defaultRoot: null }))
    const res = await app.request('/api/statistics/usage?task=&step=&groupBy=&from=&to=')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json()
    expect(body.groupBy).toBe('task')
    expect(body.totals.totalTokens).toBe(1300)
  })

  test('tên trên dây task / step lọc đúng; taskId / stepId trên query bị bỏ qua', async () => {
    const app = await createApp(createRegistryContext({ defaultRoot: null }))
    const wire = await (await app.request('/api/statistics/usage?step=implement&task=TB')).json()
    expect(wire.totals.totalTokens).toBe(900)
    const dtoNames = await (await app.request('/api/statistics/usage?taskId=TB&stepId=x')).json()
    expect(dtoNames.totals.totalTokens).toBe(1300)
  })

  test('project không resolve được root vẫn 200 (usage là global, route không đòi root)', async () => {
    const app = await createApp(createRegistryContext({ defaultRoot: null }))
    const res = await app.request('/api/statistics/usage?project=ghost')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.groups).toEqual([])
  })

  test('to dạng epoch-ms lọc theo mốc', async () => {
    const app = await createApp(createRegistryContext({ defaultRoot: null }))
    const res = await app.request(`/api/statistics/usage?to=${T0 - 1}`)
    expect(res.status).toBe(200)
    expect((await res.json()).totals.entries).toBe(0)
  })

  test('method khác GET trên path đã khai → 405 method not allowed', async () => {
    const app = await createApp(createRegistryContext({ defaultRoot: null }))
    const res = await app.request('/api/statistics/usage', { method: 'POST' })
    expect(res.status).toBe(405)
    expect(await res.json()).toEqual({ error: 'method not allowed' })
  })
})
