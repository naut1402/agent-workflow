import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  aggregateUsage,
  getUsageStats,
  parseTimeBoundMs,
  resetUsageStatsCacheForTest,
} from '../../../../../src/features/statistics/business/usageStats.js'
import type { UsageLogEntry } from '../../../../../src/core/log/schema.js'

// Usage-stats aggregation round-trips against a tmp DEV_TEAM_DASHBOARD_HOME —
// never touches the real ~/.dev-team-dashboard.
let home: string
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME

function usageFile() {
  return path.join(home, 'logs', 'usage.jsonl')
}

function entry(p: Partial<UsageLogEntry> & { jobId: string; ts: number }): UsageLogEntry {
  return {
    type: 'usage',
    ts: p.ts,
    iso: new Date(p.ts).toISOString(),
    level: 'info',
    traceId: '',
    inputTokens: p.inputTokens ?? 0,
    outputTokens: p.outputTokens ?? 0,
    cacheReadTokens: p.cacheReadTokens,
    cacheWriteTokens: p.cacheWriteTokens,
    totalTokens: p.totalTokens ?? 0,
    estimatedCostUsd: null,
    model: p.model ?? null,
    provider: p.provider ?? 'claude-code-cli',
    taskId: p.taskId ?? null,
    projectId: p.projectId ?? null,
    stepId: p.stepId ?? null,
    phase: p.phase ?? null,
    pipelineId: p.pipelineId ?? null,
    jobId: p.jobId,
    sessionId: p.sessionId ?? null,
    startedAt: p.startedAt ?? null,
    finishedAt: p.finishedAt ?? null,
    durationMs: p.durationMs ?? null,
    source: p.source,
    agentType: p.agentType ?? null,
  }
}

// Ngày cố định (UTC) để bucket `date` và filter from/to deterministic.
const T0 = Date.parse('2026-08-01T10:00:00.000Z')
const T1 = Date.parse('2026-08-01T12:00:00.000Z')
const T2 = Date.parse('2026-08-02T09:00:00.000Z')

function seedLines(): string {
  const lines = [
    // Task A (project p1): 2 job khác nhau, cùng step implement.
    entry({
      ts: T0,
      jobId: 'job-a1',
      projectId: 'p1',
      taskId: 'TA1',
      stepId: 'implement',
      model: 'claude-sonnet',
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10,
      totalTokens: 160,
      durationMs: 1_000,
      source: 'main',
    }),
    entry({
      ts: T1,
      jobId: 'job-a2',
      projectId: 'p1',
      taskId: 'TA1',
      stepId: 'implement',
      model: 'claude-sonnet',
      inputTokens: 200,
      outputTokens: 80,
      totalTokens: 280,
      durationMs: 2_000,
      source: 'subagent',
    }),
    // Task B (project p1): step review, model khác.
    entry({
      ts: T2,
      jobId: 'job-b1',
      projectId: 'p1',
      taskId: 'TB1',
      stepId: 'review',
      model: 'claude-opus',
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      durationMs: 60_000,
      source: 'aggregate',
    }),
    // Project khác + entry không attribution (taskId null).
    entry({
      ts: T2,
      jobId: 'job-c1',
      projectId: 'p2',
      taskId: 'TC1',
      stepId: 'implement',
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    }),
    entry({
      ts: T2,
      jobId: 'job-d1',
      projectId: null,
      taskId: null,
      stepId: null,
      inputTokens: 7,
      outputTokens: 3,
      totalTokens: 10,
    }),
  ]
  const junk = ['not json', '{"type":"request"}', '']
  return [...lines.map((e) => JSON.stringify(e)), ...junk].join('\n')
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-usagestats-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
})
afterAll(() => {
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  fs.rmSync(home, { recursive: true, force: true })
})
beforeEach(() => {
  resetUsageStatsCacheForTest()
  fs.mkdirSync(path.join(home, 'logs'), { recursive: true })
  fs.writeFileSync(usageFile(), seedLines())
})

describe('statistics/aggregateUsage (pure)', () => {
  const entries: UsageLogEntry[] = [
    entry({ ts: T0, jobId: 'j1', projectId: 'p1', taskId: 'TA', stepId: 'implement', model: 'claude-sonnet', inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, totalTokens: 160, durationMs: 1_000, source: 'main' }),
    entry({ ts: T1, jobId: 'j2', projectId: 'p1', taskId: 'TA', stepId: 'implement', model: 'claude-sonnet', inputTokens: 200, outputTokens: 80, cacheWriteTokens: 5, totalTokens: 280, durationMs: 2_000, source: 'subagent' }),
    entry({ ts: T2, jobId: 'j3', projectId: 'p1', taskId: 'TB', stepId: 'review', model: 'claude-opus', inputTokens: 1000, outputTokens: 500, totalTokens: 1500, durationMs: 60_000, source: 'aggregate' }),
  ]

  test('groupBy task: sum metric + distinct jobs + sort totalTokens desc', () => {
    const r = aggregateUsage(entries, { groupBy: 'task', project: 'p1' })
    expect(r.groups.map((g) => g.key)).toEqual(['TB', 'TA'])
    const ta = r.groups[1]
    expect(ta.entries).toBe(2)
    expect(ta.jobs).toBe(2) // j1 + j2 distinct
    expect(ta.inputTokens).toBe(300)
    expect(ta.outputTokens).toBe(130)
    expect(ta.cacheReadTokens).toBe(10)
    expect(ta.cacheWriteTokens).toBe(5)
    expect(ta.totalTokens).toBe(440)
    expect(ta.durationMs).toBe(3_000)
    expect(ta.firstTs).toBe(T0)
    expect(ta.lastTs).toBe(T1)
    expect(r.totals.entries).toBe(3)
    expect(r.totals.totalTokens).toBe(1940)
    expect(r.totals.jobs).toBe(3)
    expect(r.totals.firstTs).toBe(T0)
    expect(r.totals.lastTs).toBe(T2)
  })

  test('filter task + step thu về đúng subset', () => {
    const r = aggregateUsage(entries, { groupBy: 'job', project: 'p1', taskId: 'TA', stepId: 'implement' })
    expect(r.groups.map((g) => g.key).sort()).toEqual(['j1', 'j2'])
    expect(r.totals.totalTokens).toBe(440)
  })

  test('groupBy date: bucket UTC YYYY-MM-DD tăng dần', () => {
    const r = aggregateUsage(entries, { groupBy: 'date' })
    expect(r.groups.map((g) => g.key)).toEqual(['2026-08-01', '2026-08-02'])
    expect(r.groups[0].totalTokens).toBe(440)
    expect(r.groups[1].totalTokens).toBe(1500)
  })

  test('from/to lọc theo ts', () => {
    const r = aggregateUsage(entries, { groupBy: 'task', fromMs: T1, toMs: T1 })
    expect(r.groups.map((g) => g.key)).toEqual(['TA'])
  })

  test('groupBy model / source / project lấy dimension đúng', () => {
    // Opus (1500) đứng trước sonnet (440) theo totalTokens desc.
    expect(aggregateUsage(entries, { groupBy: 'model' }).groups.map((g) => g.key)).toEqual([
      'claude-opus',
      'claude-sonnet',
    ])
    expect(aggregateUsage(entries, { groupBy: 'source' }).groups.map((g) => g.key)).toEqual([
      'aggregate',
      'subagent',
      'main',
    ])
    expect(aggregateUsage(entries, { groupBy: 'project' }).groups.map((g) => g.key)).toEqual(['p1'])
  })

  test('MAX_GROUPS cắt bớt + truncated flag', () => {
    const many = Array.from({ length: 205 }, (_, i) =>
      entry({ ts: T0 + i, jobId: `j${i}`, projectId: 'p1', taskId: `T${i}`, totalTokens: 1 }),
    )
    const r = aggregateUsage(many, { groupBy: 'task' })
    expect(r.groups.length).toBe(200)
    expect(r.truncated).toBe(true)
    expect(r.totals.entries).toBe(205) // totals tính trên TOÀN bộ group trước khi cắt
  })
})

describe('statistics/getUsageStats (đọc file)', () => {
  test('đọc usage.jsonl: bỏ dòng hỏng, group theo task', async () => {
    const r = await getUsageStats({ groupBy: 'task', project: 'p1' })
    // TB1 (1500) > TA1 (440); entry p2 + entry không attribution bị lọc project.
    expect(r.groups.map((g) => g.key)).toEqual(['TB1', 'TA1'])
    expect(r.totals.entries).toBe(3)
  })

  test('entry thiếu attribution gộp vào group key rỗng', async () => {
    const r = await getUsageStats({ groupBy: 'task' })
    const unattributed = r.groups.find((g) => g.key === '')
    expect(unattributed?.totalTokens).toBe(10)
  })

  test('file không tồn tại → kết quả rỗng, không throw', async () => {
    fs.rmSync(usageFile())
    resetUsageStatsCacheForTest()
    const r = await getUsageStats({ groupBy: 'task' })
    expect(r.groups).toEqual([])
    expect(r.totals.entries).toBe(0)
    expect(r.totals.firstTs).toBe(null)
  })

  test('cache TTL: ghi thêm entry mới nhưng vẫn thấy trong lần gọi kế (cache reset mỗi test)', async () => {
    await getUsageStats({ groupBy: 'task' })
    fs.appendFileSync(usageFile(), `${JSON.stringify(entry({ ts: T2, jobId: 'job-new', projectId: 'p1', taskId: 'TA1', totalTokens: 5 }))}\n`)
    resetUsageStatsCacheForTest()
    const r = await getUsageStats({ groupBy: 'task', project: 'p1' })
    const ta = r.groups.find((g) => g.key === 'TA1')
    expect(ta?.entries).toBe(3)
  })
})

describe('statistics/parseTimeBoundMs', () => {
  test('ISO + epoch-ms + invalid', () => {
    expect(parseTimeBoundMs('2026-08-01T00:00:00Z')).toBe(Date.parse('2026-08-01T00:00:00Z'))
    expect(parseTimeBoundMs('1785000000000')).toBe(1785000000000)
    expect(parseTimeBoundMs('not-a-date')).toBe(null)
  })
})
