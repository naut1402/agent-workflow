import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  bindAutomationRunner,
  collectDueSchedules,
  tickAutomationScheduler,
} from '../../../../src/features/automations/business/scheduler.js'
import { createAutomation } from '../../../../src/features/automations/business/rules.js'
import { getRuleState, listRuns } from '../../../../src/features/automations/business/runLedger.js'

let home: string
let root: string
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME
const prevRoot = process.env.DEV_TEAM_ROOT

const calls: Array<{ projectId: string; ruleId: string; source: string }> = []

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'automations-home-'))
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'automations-root-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  delete process.env.DEV_TEAM_ROOT
  fs.mkdirSync(path.join(home), { recursive: true })
  fs.writeFileSync(
    path.join(home, 'projects.json'),
    JSON.stringify({ version: 1, projects: [{ id: 'p1', name: 'P1', kind: 'local', path: root, addedAt: new Date().toISOString(), default: true }] }),
  )
  calls.length = 0
  bindAutomationRunner(async (input) => {
    calls.push({ projectId: String(input.projectId), ruleId: input.rule.id, source: input.source })
  })
})

afterEach(() => {
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  if (prevRoot === undefined) delete process.env.DEV_TEAM_ROOT
  else process.env.DEV_TEAM_ROOT = prevRoot
  fs.rmSync(home, { recursive: true, force: true })
  fs.rmSync(root, { recursive: true, force: true })
})

describe('collectDueSchedules', () => {
  test('past one-shot is due once, then never again', async () => {
    const created = createAutomation(root, {
      name: 'Once',
      enabled: true,
      trigger: { kind: 'time', at: '2020-01-01T00:00:00.000Z' },
      action: { kind: 'runTask', mode: 'create', prompt: 'p' },
    })
    if ('error' in created) throw new Error(created.error)

    expect(collectDueSchedules(new Date())).toHaveLength(1)

    // Giả lập run đã diễn ra (như runAction sẽ ghi): state.fired → không due nữa.
    const { setRuleState } = await import('../../../../src/features/automations/business/runLedger.js')
    setRuleState('p1', 'once', { lastRunAt: new Date().toISOString(), lastOutcome: 'succeeded', fired: true })
    expect(collectDueSchedules(new Date())).toHaveLength(0)
  })

  test('disabled rule and event rule are never due by tick', () => {
    createAutomation(root, {
      name: 'Off',
      enabled: false,
      trigger: { kind: 'interval', everyMs: 60_000 },
      action: { kind: 'runTask', mode: 'create', prompt: 'p' },
    })
    createAutomation(root, {
      name: 'On event',
      enabled: true,
      trigger: { kind: 'event', eventType: 'job.failed' },
      action: { kind: 'runTask', mode: 'create', prompt: 'p' },
    })
    expect(collectDueSchedules(new Date())).toHaveLength(0)
  })

  test('overdue interval coalesces to a single run per tick', async () => {
    createAutomation(root, {
      name: 'Every 30m',
      enabled: true,
      trigger: { kind: 'interval', everyMs: 30 * 60_000 },
      action: { kind: 'runTask', mode: 'create', prompt: 'p' },
    })

    // Chưa qua interval đầu → chưa due.
    expect(collectDueSchedules(new Date())).toHaveLength(0)

    // Giả lập đã chạy 6h trước → 12 slot lỡ, vẫn chỉ 1 run.
    const { setRuleState } = await import('../../../../src/features/automations/business/runLedger.js')
    setRuleState('p1', 'every-30m', { lastRunAt: new Date(Date.now() - 6 * 3_600_000).toISOString(), lastOutcome: 'succeeded' })
    const due = collectDueSchedules(new Date())
    expect(due).toHaveLength(1)

    const triggered = await tickAutomationScheduler()
    expect(triggered).toBe(1)
    expect(calls).toEqual([{ projectId: 'p1', ruleId: 'every-30m', source: 'schedule' }])
  })
})

describe('tickAutomationScheduler', () => {
  test('runs due rules sequentially and records nothing extra on clean tick', async () => {
    createAutomation(root, {
      name: 'Nightly',
      enabled: true,
      trigger: { kind: 'cron', cron: '* * * * *' }, // mỗi phút
      action: { kind: 'runTask', mode: 'create', prompt: 'p' },
    })

    // Rule vừa tạo → lần cron đầu là phút kế (không due ngay — đúng semantic).
    expect(await tickAutomationScheduler()).toBe(0)

    // Giả lập lần chạy cuối 2 phút trước → phút vừa qua đã lỡ → due 1 lần.
    const { setRuleState } = await import('../../../../src/features/automations/business/runLedger.js')
    setRuleState('p1', 'nightly', { lastRunAt: new Date(Date.now() - 2 * 60_000).toISOString(), lastOutcome: 'succeeded' })

    const count = await tickAutomationScheduler()
    expect(count).toBe(1)
    expect(calls).toEqual([{ projectId: 'p1', ruleId: 'nightly', source: 'schedule' }])

    // Stub runner không ghi run ledger / state — đúng thiết kế DI.
    expect(listRuns('p1', 10)).toEqual([])
    const state = getRuleState('p1', 'nightly')
    expect(state.lastRunAt).not.toBeNull()
  })

  test('runner error is swallowed and does not break the tick', async () => {
    bindAutomationRunner(async () => {
      throw new Error('boom')
    })
    createAutomation(root, {
      name: 'Bad runner',
      enabled: true,
      trigger: { kind: 'cron', cron: '* * * * *' },
      action: { kind: 'runTask', mode: 'create', prompt: 'p' },
    })
    const count = await tickAutomationScheduler()
    expect(count).toBe(0) // lỗi không tính là triggered
  })
})
