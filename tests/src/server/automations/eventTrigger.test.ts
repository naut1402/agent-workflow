import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { emit, _resetEventBusForTest } from '../../../../src/core/events/index.js'
import {
  handleEvent,
  startEventTriggers,
  _resetEventTriggersForTest,
} from '../../../../src/features/automations/business/eventTrigger.js'
import { bindAutomationRunner } from '../../../../src/features/automations/business/scheduler.js'
import { createAutomation } from '../../../../src/features/automations/business/rules.js'
import { setRuleState } from '../../../../src/features/automations/business/runLedger.js'

let home: string
let root: string
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME

const calls: Array<{ projectId: string; ruleId: string; source: string }> = []

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Handler async — poll tới khi điều kiện đúng thay vì sleep cố định. */
async function waitFor(cond: () => boolean, timeoutMs = 5000): Promise<void> {
  const started = Date.now()
  while (!cond()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timeout')
    await sleep(20)
  }
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'automations-evthome-'))
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'automations-evtroot-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
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
  _resetEventBusForTest()
  _resetEventTriggersForTest()
  fs.rmSync(home, { recursive: true, force: true })
  fs.rmSync(root, { recursive: true, force: true })
})

function makeEventRule(name: string, eventType: string): string {
  const result = createAutomation(root, {
    name,
    enabled: true,
    triggers: [{ kind: 'event', eventType }],
    actions: [{ kind: 'runTask', mode: 'create', prompt: 'p' }],
  })
  if ('error' in result) throw new Error(result.error)
  return result.automation.id
}

function fakeEvent(type: string, payload: Record<string, unknown> = {}) {
  return { type, at: new Date().toISOString(), payload }
}

describe('handleEvent (đối chiếu trực tiếp — deterministic)', () => {
  test('matching event + projectId runs the rule once', async () => {
    const ruleId = makeEventRule('On job fail', 'job.failed')
    await handleEvent(fakeEvent('job.failed', { jobId: 'j1', projectId: 'p1' }))
    expect(calls).toEqual([{ projectId: 'p1', ruleId, source: 'event' }])
  })

  test('event without projectId never matches', async () => {
    makeEventRule('On any job fail', 'job.failed')
    await handleEvent(fakeEvent('job.failed', { jobId: 'j1' }))
    expect(calls).toEqual([])
  })

  test('event from another project never matches', async () => {
    makeEventRule('On job fail', 'job.failed')
    await handleEvent(fakeEvent('job.failed', { jobId: 'j1', projectId: 'other' }))
    expect(calls).toEqual([])
  })

  test('automation feedback events are ignored (loop guard)', async () => {
    makeEventRule('On run failed', 'automation.run_failed')
    await handleEvent(fakeEvent('automation.run_failed', { automationId: 'x', projectId: 'p1' }))
    await handleEvent(fakeEvent('automation.triggered', { automationId: 'x', projectId: 'p1' }))
    expect(calls).toEqual([])
  })

  test('coalesce: rule that just ran is skipped within the min gap', async () => {
    const ruleId = makeEventRule('On job fail', 'job.failed')
    setRuleState('p1', ruleId, { lastRunAt: new Date().toISOString(), lastOutcome: 'succeeded' })
    await handleEvent(fakeEvent('job.failed', { jobId: 'j1', projectId: 'p1' }))
    expect(calls).toEqual([])

    // Sau khoảng coalesce (10s) — mô phỏng bằng lastRunAt cũ.
    setRuleState('p1', ruleId, { lastRunAt: new Date(Date.now() - 60_000).toISOString(), lastOutcome: 'succeeded' })
    await handleEvent(fakeEvent('job.failed', { jobId: 'j2', projectId: 'p1' }))
    expect(calls).toHaveLength(1)
  })

  test('in-flight rule is skipped', async () => {
    makeEventRule('On job fail', 'job.failed')
    setRuleState('p1', 'on-job-fail', { lastRunAt: null, lastOutcome: null, inFlight: true })
    await handleEvent(fakeEvent('job.failed', { jobId: 'j1', projectId: 'p1' }))
    expect(calls).toEqual([])
  })

  test('disabled rule never runs', async () => {
    const created = createAutomation(root, {
      name: 'Off rule',
      enabled: false,
      triggers: [{ kind: 'event', eventType: 'job.failed' }],
      actions: [{ kind: 'runTask', mode: 'create', prompt: 'p' }],
    })
    if ('error' in created) throw new Error(created.error)
    await handleEvent(fakeEvent('job.failed', { projectId: 'p1' }))
    expect(calls).toEqual([])
  })
})

describe('multi event trigger', () => {
  test('rule khớp khi MỘT trong nhiều event trigger trùng type — truyền event payload cho runner', async () => {
    const created = createAutomation(root, {
      name: 'Two sources',
      enabled: true,
      triggers: [
        { kind: 'timer', startAt: '2030-01-01T00:00:00.000Z', repeat: { mode: 'once' } },
        { kind: 'event', eventType: 'task.created' },
      ],
      actions: [{ kind: 'runTask', mode: 'create', prompt: 'p' }],
    })
    if ('error' in created) throw new Error(created.error)
    const ruleId = created.automation.id

    let seenEvent: { type: string; payload: Record<string, unknown> } | null = null
    bindAutomationRunner(async (input) => {
      if (input.event) seenEvent = input.event
      calls.push({ projectId: String(input.projectId), ruleId: input.rule.id, source: input.source })
    })
    await handleEvent(fakeEvent('task.created', { taskId: 'T1', projectId: 'p1' }))
    expect(calls).toHaveLength(1)
    expect(calls[0].ruleId).toBe(ruleId)
    expect(seenEvent).toEqual({ type: 'task.created', payload: { taskId: 'T1', projectId: 'p1' } })
  })
})

describe('startEventTriggers (subscription)', () => {
  test('wildcard subscription delivers bus events to handleEvent', async () => {
    const ruleId = makeEventRule('On job fail', 'job.failed')
    startEventTriggers()
    emit('job.failed', { jobId: 'j1', projectId: 'p1' })
    await waitFor(() => calls.length > 0)
    expect(calls).toEqual([{ projectId: 'p1', ruleId, source: 'event' }])
  })
})
