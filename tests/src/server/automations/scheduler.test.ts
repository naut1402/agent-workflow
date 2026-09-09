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
import { getRuleState, listRuns, setRuleState } from '../../../../src/features/automations/business/runLedger.js'

let home: string
let root: string
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME
const prevRoot = process.env.DEV_TEAM_ROOT

const calls: Array<{ projectId: string; ruleId: string; source: string; triggerId?: string }> = []

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
    calls.push({ projectId: String(input.projectId), ruleId: input.rule.id, source: input.source, triggerId: input.triggerId })
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
  test('past one-shot is due once, then never again (triggerFired)', () => {
    const created = createAutomation(root, {
      name: 'Once',
      enabled: true,
      triggers: [{ kind: 'timer', startAt: '2020-01-01T00:00:00.000Z', repeat: { mode: 'once' } }],
      actions: [{ kind: 'runTask', mode: 'create', prompt: 'p' }],
    })
    if ('error' in created) throw new Error(created.error)

    expect(collectDueSchedules(new Date())).toHaveLength(1)

    // Giả lập run đã diễn ra (như runAction sẽ ghi): triggerFired → không due nữa.
    setRuleState('p1', 'once', { lastRunAt: new Date().toISOString(), lastOutcome: 'succeeded', triggerFired: { t1: true } })
    expect(collectDueSchedules(new Date())).toHaveLength(0)
  })

  test('due khi MỘT trong nhiều timer trigger due', () => {
    createAutomation(root, {
      name: 'Multi',
      enabled: true,
      triggers: [
        { kind: 'timer', startAt: '2030-01-01T00:00:00.000Z', repeat: { mode: 'once' } },
        { kind: 'timer', startAt: '2020-01-01T00:00:00.000Z', repeat: { mode: 'interval', everyMs: 60_000 } },
      ],
      actions: [{ kind: 'runTask', mode: 'create', prompt: 'p' }],
    })
    const due = collectDueSchedules(new Date())
    expect(due).toHaveLength(1)
    expect(due[0].triggerId).toBe('t2')
  })

  test('disabled rule and event-only rule are never due by tick', () => {
    createAutomation(root, {
      name: 'Off',
      enabled: false,
      triggers: [{ kind: 'timer', startAt: '2020-01-01T00:00:00.000Z', repeat: { mode: 'interval', everyMs: 60_000 } }],
      actions: [{ kind: 'runTask', mode: 'create', prompt: 'p' }],
    })
    createAutomation(root, {
      name: 'On event',
      enabled: true,
      triggers: [{ kind: 'event', eventType: 'job.failed' }],
      actions: [{ kind: 'runTask', mode: 'create', prompt: 'p' }],
    })
    expect(collectDueSchedules(new Date())).toHaveLength(0)
  })
})

describe('tickAutomationScheduler', () => {
  test('runs due rules and passes the matching triggerId', async () => {
    createAutomation(root, {
      name: 'Nightly',
      enabled: true,
      triggers: [{ kind: 'timer', startAt: '2020-01-01T00:00:00.000Z', repeat: { mode: 'interval', everyMs: 30 * 60_000 } }],
      actions: [{ kind: 'runTask', mode: 'create', prompt: 'p' }],
    })

    const count = await tickAutomationScheduler()
    expect(count).toBe(1)
    expect(calls).toEqual([{ projectId: 'p1', ruleId: 'nightly', source: 'schedule', triggerId: 't1' }])

    // Stub runner không ghi run ledger / state — đúng thiết kế DI.
    expect(listRuns('p1', 10)).toEqual([])
    const state = getRuleState('p1', 'nightly')
    expect(state.lastRunAt).toBeNull()
  })

  test('runner error is swallowed and does not break the tick', async () => {
    bindAutomationRunner(async () => {
      throw new Error('boom')
    })
    createAutomation(root, {
      name: 'Bad runner',
      enabled: true,
      triggers: [{ kind: 'timer', startAt: '2020-01-01T00:00:00.000Z', repeat: { mode: 'interval', everyMs: 60_000 } }],
      actions: [{ kind: 'runTask', mode: 'create', prompt: 'p' }],
    })
    const count = await tickAutomationScheduler()
    expect(count).toBe(0) // lỗi không tính là triggered
  })
})
