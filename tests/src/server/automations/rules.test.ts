import { beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createAutomation,
  deleteAutomation,
  getAutomation,
  listAutomations,
  sanitiseAutomationId,
  setAutomationEnabled,
  syncTriggerRegistry,
  updateAutomation,
} from '../../../../src/features/automations/business/rules.js'
import {
  _resetTriggersForTest,
  listTriggers,
} from '../../../../src/core/events/index.js'

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'automations-rules-'))
  _resetTriggersForTest()
})

const baseBody = {
  name: 'Nightly check',
  enabled: true,
  trigger: { kind: 'cron' as const, cron: '0 9 * * *' },
  action: { kind: 'runTask' as const, mode: 'create' as const, prompt: 'run the nightly check' },
}

describe('sanitiseAutomationId', () => {
  test('slugifies names and strips traversal input', () => {
    expect(sanitiseAutomationId('Nightly Build Check')).toBe('nightly-build-check')
    expect(sanitiseAutomationId('../../etc/passwd')).toBe('etc-passwd')
    expect(sanitiseAutomationId('..')).toBe('')
    expect(sanitiseAutomationId('Đi ngủ 22h!')).toBe('i-ngu-22h')
  })
})

describe('createAutomation', () => {
  test('creates from name slug and round-trips through YAML', () => {
    const result = createAutomation(root, baseBody)
    if ('error' in result) throw new Error(result.error)
    expect(result.automation.id).toBe('nightly-check')
    expect(result.automation.enabled).toBe(true)

    const loaded = getAutomation(root, 'nightly-check')
    expect(loaded).not.toBeNull()
    expect(loaded!.trigger).toEqual({ kind: 'cron', cron: '0 9 * * *' })
    expect(loaded!.action).toEqual({ kind: 'runTask', mode: 'create', prompt: 'run the nightly check' })
  })

  test('auto-suffixes when the slug is taken', () => {
    createAutomation(root, baseBody)
    const second = createAutomation(root, baseBody)
    if ('error' in second) throw new Error(second.error)
    expect(second.automation.id).toBe('nightly-check-2')
    expect(listAutomations(root)).toHaveLength(2)
  })

  test('rejects invalid cron semantics', () => {
    const bad = createAutomation(root, { ...baseBody, trigger: { kind: 'cron', cron: '99 * * * *' } })
    expect('error' in bad).toBe(true)
  })

  test('rejects undervivable id', () => {
    const bad = createAutomation(root, { ...baseBody, name: '!!!' })
    expect('error' in bad).toBe(true)
  })
})

describe('updateAutomation', () => {
  test('replaces content but keeps id + createdAt', () => {
    const created = createAutomation(root, baseBody)
    if ('error' in created) throw new Error(created.error)
    const updated = updateAutomation(root, 'nightly-check', {
      name: 'Renamed',
      enabled: false,
      trigger: { kind: 'interval', everyMs: 3_600_000 },
      action: { kind: 'runTask', mode: 'existing', taskId: 'Tabc1234' },
    })
    if ('error' in updated) throw new Error(updated.error)
    expect(updated.automation.name).toBe('Renamed')
    expect(updated.automation.enabled).toBe(false)
    expect(updated.automation.createdAt).toBe(created.automation.createdAt)

    const loaded = getAutomation(root, 'nightly-check')
    expect(loaded!.trigger).toEqual({ kind: 'interval', everyMs: 3_600_000 })
  })

  test('404 on missing rule; 400 on invalid id', () => {
    const missing = updateAutomation(root, 'nope', {
      name: 'x',
      enabled: true,
      trigger: { kind: 'time', at: '2026-09-01T00:00:00.000Z' },
      action: { kind: 'runTask', mode: 'create', prompt: 'p' },
    })
    expect('error' in missing && missing.status).toBe(404)

    const badId = updateAutomation(root, '../escape', {
      name: 'x',
      enabled: true,
      trigger: { kind: 'time', at: '2026-09-01T00:00:00.000Z' },
      action: { kind: 'runTask', mode: 'create', prompt: 'p' },
    })
    expect('error' in badId && badId.status).toBe(400)
  })
})

describe('setAutomationEnabled / deleteAutomation', () => {
  test('toggle persists; delete removes and then 404s', () => {
    createAutomation(root, baseBody)

    const off = setAutomationEnabled(root, 'nightly-check', false)
    expect('error' in off).toBe(false)
    expect(getAutomation(root, 'nightly-check')!.enabled).toBe(false)

    const removed = deleteAutomation(root, 'nightly-check')
    expect('error' in removed).toBe(false)
    expect(getAutomation(root, 'nightly-check')).toBeNull()
    const gone = deleteAutomation(root, 'nightly-check')
    expect('error' in gone && gone.status).toBe(404)
  })
})

describe('defensive read', () => {
  test('corrupt YAML file is skipped, not thrown', () => {
    fs.mkdirSync(path.join(root, 'automations'), { recursive: true })
    fs.writeFileSync(path.join(root, 'automations', 'broken.yaml'), '\tnot: [valid: yaml')
    fs.writeFileSync(
      path.join(root, 'automations', 'wrong-shape.yaml'),
      'version: 1\nid: wrong-shape\nname: x\n',
    )
    expect(listAutomations(root)).toEqual([])
    expect(getAutomation(root, 'broken')).toBeNull()
  })
})

describe('syncTriggerRegistry', () => {
  test('enabled rules registered, disabled removed, deleted unregistered', () => {
    createAutomation(root, baseBody)
    createAutomation(root, {
      ...baseBody,
      name: 'On job failure',
      trigger: { kind: 'event', eventType: 'job.failed' },
    })
    setAutomationEnabled(root, 'nightly-check', false)

    syncTriggerRegistry(root, 'p1')

    const triggers = listTriggers()
    expect(triggers.map((t) => t.id).sort()).toEqual(['p1:on-job-failure'])
    expect(triggers[0].kind).toBe('event')
    expect(triggers[0].match).toBe('job.failed')
  })
})
