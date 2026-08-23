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
  triggers: [
    { kind: 'timer' as const, startAt: '2026-09-01T02:00:00.000Z', repeat: { mode: 'cron' as const, expr: '0 9 * * *' } },
  ],
  actions: [{ kind: 'runTask' as const, mode: 'create' as const, prompt: 'run the nightly check' }],
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
  test('creates from name slug, mints trigger ids, round-trips YAML', () => {
    const result = createAutomation(root, baseBody)
    if ('error' in result) throw new Error(result.error)
    expect(result.automation.id).toBe('nightly-check')
    expect(result.automation.enabled).toBe(true)
    // Trigger id do server mint (t1) dù body không gửi.
    expect(result.automation.triggers[0].id).toBe('t1')

    const loaded = getAutomation(root, 'nightly-check')
    expect(loaded).not.toBeNull()
    expect(loaded!.triggers).toEqual([
      { id: 't1', kind: 'timer', startAt: '2026-09-01T02:00:00.000Z', repeat: { mode: 'cron', expr: '0 9 * * *' } },
    ])
    expect(loaded!.actions).toEqual([{ kind: 'runTask', mode: 'create', prompt: 'run the nightly check' }])
  })

  test('auto-suffixes when the slug is taken', () => {
    createAutomation(root, baseBody)
    const second = createAutomation(root, baseBody)
    if ('error' in second) throw new Error(second.error)
    expect(second.automation.id).toBe('nightly-check-2')
    expect(listAutomations(root)).toHaveLength(2)
  })

  test('rejects invalid cron semantics + duplicate trigger id', () => {
    const bad = createAutomation(root, {
      ...baseBody,
      triggers: [{ id: 't1', kind: 'timer', startAt: '2026-09-01T00:00:00.000Z', repeat: { mode: 'cron', expr: '99 * * * *' } }],
    })
    expect('error' in bad).toBe(true)

    const dup = createAutomation(root, {
      ...baseBody,
      triggers: [
        { id: 't1', kind: 'timer', startAt: '2026-09-01T00:00:00.000Z', repeat: { mode: 'once' } },
        { id: 't1', kind: 'timer', startAt: '2026-09-02T00:00:00.000Z', repeat: { mode: 'once' } },
      ],
    })
    expect('error' in dup).toBe(true)
  })

  test('rejects undervivable id', () => {
    const bad = createAutomation(root, { ...baseBody, name: '!!!' })
    expect('error' in bad).toBe(true)
  })
})

describe('updateAutomation', () => {
  test('replaces content but keeps id + createdAt; keeps existing trigger ids', () => {
    const created = createAutomation(root, baseBody)
    if ('error' in created) throw new Error(created.error)
    const updated = updateAutomation(root, 'nightly-check', {
      name: 'Renamed',
      enabled: false,
      triggers: [
        { id: 't1', kind: 'timer', startAt: '2026-09-01T00:00:00.000Z', repeat: { mode: 'interval', everyMs: 3_600_000 } },
        { kind: 'event', eventType: 'job.failed' },
      ],
      actions: [{ kind: 'runTask', mode: 'existing', taskId: 'Tabc1234' }],
    })
    if ('error' in updated) throw new Error(updated.error)
    expect(updated.automation.name).toBe('Renamed')
    expect(updated.automation.enabled).toBe(false)
    expect(updated.automation.createdAt).toBe(created.automation.createdAt)
    // t1 giữ nguyên, trigger mới thiếu id được mint t2.
    expect(updated.automation.triggers.map((t) => t.id)).toEqual(['t1', 't2'])
  })

  test('404 on missing rule; 400 on invalid id', () => {
    const missing = updateAutomation(root, 'nope', {
      name: 'x',
      enabled: true,
      triggers: [{ kind: 'timer', startAt: '2026-09-01T00:00:00.000Z', repeat: { mode: 'once' } }],
      actions: [{ kind: 'runTask', mode: 'create', prompt: 'p' }],
    })
    expect('error' in missing && missing.status).toBe(404)

    const badId = updateAutomation(root, '../escape', {
      name: 'x',
      enabled: true,
      triggers: [{ kind: 'timer', startAt: '2026-09-01T00:00:00.000Z', repeat: { mode: 'once' } }],
      actions: [{ kind: 'runTask', mode: 'create', prompt: 'p' }],
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

describe('legacy shape (trigger/action đơn) → triggers/actions[]', () => {
  test('time/interval/cron/event cũ đọc lên thành timer/event + ghi lại shape mới', () => {
    fs.mkdirSync(path.join(root, 'automations'), { recursive: true })
    const createdAt = '2026-08-01T00:00:00.000Z'
    fs.writeFileSync(
      path.join(root, 'automations', 'legacy-time.yaml'),
      `version: 1\nid: legacy-time\nname: Legacy time\nenabled: true\ncreatedAt: ${createdAt}\nupdatedAt: ${createdAt}\ntrigger:\n  kind: time\n  at: 2026-08-15T01:00:00.000Z\naction:\n  kind: runTask\n  mode: create\n  prompt: p\n`,
    )
    fs.writeFileSync(
      path.join(root, 'automations', 'legacy-interval.yaml'),
      `version: 1\nid: legacy-interval\nname: Legacy interval\nenabled: true\ncreatedAt: ${createdAt}\nupdatedAt: ${createdAt}\ntrigger:\n  kind: interval\n  everyMs: 3600000\naction:\n  kind: runTask\n  mode: create\n  prompt: p\n`,
    )
    fs.writeFileSync(
      path.join(root, 'automations', 'legacy-event.yaml'),
      `version: 1\nid: legacy-event\nname: Legacy event\nenabled: true\ncreatedAt: ${createdAt}\nupdatedAt: ${createdAt}\ntrigger:\n  kind: event\n  eventType: job.failed\naction:\n  kind: runTask\n  mode: existing\n  taskId: Tabc1234\n`,
    )

    const time = getAutomation(root, 'legacy-time')
    expect(time!.triggers).toEqual([
      { id: 't1', kind: 'timer', startAt: '2026-08-15T01:00:00.000Z', repeat: { mode: 'once' } },
    ])
    expect(time!.actions).toEqual([{ kind: 'runTask', mode: 'create', prompt: 'p' }])

    const interval = getAutomation(root, 'legacy-interval')
    expect(interval!.triggers[0]).toEqual({
      id: 't1',
      kind: 'timer',
      // interval cũ không có mốc → anchor về createdAt của record.
      startAt: createdAt,
      repeat: { mode: 'interval', everyMs: 3_600_000 },
    })

    const event = getAutomation(root, 'legacy-event')
    expect(event!.triggers).toEqual([{ id: 't1', kind: 'event', eventType: 'job.failed' }])
    expect(event!.actions).toEqual([{ kind: 'runTask', mode: 'existing', taskId: 'Tabc1234' }])
  })
})

describe('syncTriggerRegistry', () => {
  test('enabled rules registered per trigger, disabled removed, deleted unregistered', () => {
    createAutomation(root, baseBody)
    createAutomation(root, {
      ...baseBody,
      name: 'On job failure',
      triggers: [{ kind: 'event', eventType: 'job.failed' }],
    })
    setAutomationEnabled(root, 'nightly-check', false)

    syncTriggerRegistry(root, 'p1')

    const triggers = listTriggers()
    expect(triggers.map((t) => t.id).sort()).toEqual(['p1:on-job-failure:t1'])
    expect(triggers[0].kind).toBe('event')
    expect(triggers[0].match).toBe('job.failed')
  })
})
