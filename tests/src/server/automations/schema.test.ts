import { describe, expect, test } from 'bun:test'
import {
  AutomationRuleRecord,
  normaliseAutomationDoc,
} from '../../../../src/features/automations/schemas/automation.js'

/**
 * `normaliseAutomationDoc` — cửa vào duy nhất đưa rule shape cũ (trigger/action
 * đơn, timestamp dạng Date của YAML 1.1) về shape hiện hành trước khi safeParse.
 *
 * Điểm nhìn: rule người dùng tạo bằng bản cũ vẫn đọc được sau khi nâng lên
 * 1.1.0, và **idempotent** — rule bị đọc/ghi lại nhiều lần (sửa qua UI, sync
 * trigger) nên chuẩn hoá không được làm giá trị "trôi" qua từng vòng.
 */

const ACTION = { kind: 'runTask', mode: 'create', prompt: 'làm việc' }

function legacyDoc(trigger: Record<string, unknown>, over: Record<string, unknown> = {}) {
  return {
    version: 1,
    id: 'rule-a',
    name: 'Rule A',
    enabled: true,
    trigger,
    action: ACTION,
    createdAt: '2026-01-02T03:04:05.000Z',
    updatedAt: '2026-01-02T03:04:05.000Z',
    ...over,
  }
}

describe('normaliseAutomationDoc — input không dùng được', () => {
  test.each([
    ['null', null],
    ['undefined', undefined],
    ['số', 42],
    ['chuỗi', 'rule'],
    ['mảng', [{ id: 'rule-a' }]],
  ])('%s → {} (không throw)', (_label, raw) => {
    expect(normaliseAutomationDoc(raw)).toEqual({})
  })
})

describe('normaliseAutomationDoc — doc đã ở shape mới', () => {
  const modern = {
    version: 1,
    id: 'rule-a',
    name: 'Rule A',
    enabled: true,
    triggers: [{ id: 't1', kind: 'timer', startAt: '2026-01-01T00:00:00.000Z', repeat: { mode: 'once' } }],
    actions: [ACTION],
    createdAt: '2026-01-02T03:04:05.000Z',
    updatedAt: '2026-01-02T03:04:05.000Z',
  }

  test('deep-equal input, không thêm/bớt field', () => {
    expect(normaliseAutomationDoc(modern)).toEqual(modern)
  })

  test('không mutate object gốc', () => {
    const input = structuredClone(modern)
    normaliseAutomationDoc(input)
    expect(input).toEqual(modern)
  })

  test('idempotent: chuẩn hoá lần 2 trên kết quả lần 1 cho kết quả giống hệt', () => {
    const once = normaliseAutomationDoc(modern)
    expect(normaliseAutomationDoc(once)).toEqual(once)
  })
})

describe('normaliseAutomationDoc — legacy trigger đơn → triggers[]', () => {
  test("kind='time' → timer once, startAt lấy từ `at`", () => {
    const doc = normaliseAutomationDoc(legacyDoc({ kind: 'time', at: '2026-03-04T05:06:07.000Z' }))

    expect(doc.triggers).toEqual([
      { id: 't1', kind: 'timer', startAt: '2026-03-04T05:06:07.000Z', repeat: { mode: 'once' } },
    ])
  })

  test("kind='interval' → repeat interval, startAt = createdAt của record", () => {
    const doc = normaliseAutomationDoc(legacyDoc({ kind: 'interval', everyMs: 3_600_000 }))

    expect(doc.triggers).toEqual([
      {
        id: 't1',
        kind: 'timer',
        startAt: '2026-01-02T03:04:05.000Z',
        repeat: { mode: 'interval', everyMs: 3_600_000 },
      },
    ])
  })

  test("kind='cron' → repeat cron, startAt = createdAt của record", () => {
    const doc = normaliseAutomationDoc(legacyDoc({ kind: 'cron', cron: '0 9 * * 1-5' }))

    expect(doc.triggers).toEqual([
      {
        id: 't1',
        kind: 'timer',
        startAt: '2026-01-02T03:04:05.000Z',
        repeat: { mode: 'cron', expr: '0 9 * * 1-5' },
      },
    ])
  })

  test("kind='event' → giữ eventType", () => {
    const doc = normaliseAutomationDoc(legacyDoc({ kind: 'event', eventType: 'job.failed' }))

    expect(doc.triggers).toEqual([{ id: 't1', kind: 'event', eventType: 'job.failed' }])
  })

  test('kind lạ → giữ nguyên object cũ (để safeParse báo lỗi, không throw ở đây)', () => {
    const doc = normaliseAutomationDoc(legacyDoc({ kind: 'webhook', url: 'x' }))

    expect(doc.triggers).toEqual([{ kind: 'webhook', url: 'x' }])
  })

  test('createdAt không parse được → startAt là thời điểm hiện tại (ISO hợp lệ)', () => {
    const doc = normaliseAutomationDoc(
      legacyDoc({ kind: 'interval', everyMs: 60_000 }, { createdAt: 'không-phải-ngày' }),
    )

    const startAt = (doc.triggers as Array<{ startAt: string }>)[0].startAt
    expect(Number.isNaN(Date.parse(startAt))).toBe(false)
    expect(startAt).toBe(new Date(startAt).toISOString())
  })

  test('đã có triggers[] thì `trigger` cũ bị bỏ, không ghi đè', () => {
    const doc = normaliseAutomationDoc({
      ...legacyDoc({ kind: 'event', eventType: 'job.failed' }),
      triggers: [{ id: 't1', kind: 'event', eventType: 'task.created' }],
    })

    expect(doc.triggers).toEqual([{ id: 't1', kind: 'event', eventType: 'task.created' }])
  })

  test('luôn xoá khoá `trigger` và `action` khỏi kết quả', () => {
    const doc = normaliseAutomationDoc(legacyDoc({ kind: 'time', at: '2026-03-04T05:06:07.000Z' }))

    expect(doc).not.toHaveProperty('trigger')
    expect(doc).not.toHaveProperty('action')
  })
})

describe('normaliseAutomationDoc — Date của YAML 1.1 → chuỗi ISO', () => {
  test('createdAt / updatedAt / trigger.startAt dạng Date đều về ISO', () => {
    const at = new Date('2026-05-06T07:08:09.000Z')
    const doc = normaliseAutomationDoc({
      ...legacyDoc({ kind: 'time', at }),
      createdAt: at,
      updatedAt: at,
    })

    expect(doc.createdAt).toBe(at.toISOString())
    expect(doc.updatedAt).toBe(at.toISOString())
    expect((doc.triggers as Array<{ startAt: string }>)[0].startAt).toBe(at.toISOString())
  })

  test('startAt dạng Date trong triggers[] shape mới cũng được chuẩn hoá', () => {
    const at = new Date('2026-05-06T07:08:09.000Z')
    const doc = normaliseAutomationDoc({
      version: 1,
      triggers: [{ id: 't1', kind: 'timer', startAt: at, repeat: { mode: 'once' } }],
      actions: [ACTION],
    })

    expect((doc.triggers as Array<{ startAt: string }>)[0].startAt).toBe(at.toISOString())
  })

  test('trigger không phải object trong triggers[] không làm throw', () => {
    const doc = normaliseAutomationDoc({ triggers: [null, 'x', 3] })

    expect(doc.triggers).toEqual([null, 'x', 3])
  })
})

describe('normaliseAutomationDoc — legacy action đơn → actions[]', () => {
  test('`action` đơn → actions[action]', () => {
    const doc = normaliseAutomationDoc(legacyDoc({ kind: 'time', at: '2026-03-04T05:06:07.000Z' }))

    expect(doc.actions).toEqual([ACTION])
  })

  test('action thiếu `kind` (tiền union) → gán kind=runTask', () => {
    const doc = normaliseAutomationDoc(
      legacyDoc({ kind: 'time', at: '2026-03-04T05:06:07.000Z' }, { action: { mode: 'create', prompt: 'x' } }),
    )

    expect(doc.actions).toEqual([{ kind: 'runTask', mode: 'create', prompt: 'x' }])
  })

  test('actions[] có phần tử thiếu kind → cũng gán runTask', () => {
    const doc = normaliseAutomationDoc({ actions: [{ mode: 'create', prompt: 'x' }, ACTION] })

    expect(doc.actions).toEqual([{ kind: 'runTask', mode: 'create', prompt: 'x' }, ACTION])
  })

  test('actions[] có phần tử không phải object thì giữ nguyên, không throw', () => {
    const doc = normaliseAutomationDoc({ actions: [null, 'x'] })

    expect(doc.actions).toEqual([null, 'x'])
  })
})

describe('normaliseAutomationDoc → AutomationRuleRecord', () => {
  test.each([
    ['time', { kind: 'time', at: '2026-03-04T05:06:07.000Z' }],
    ['interval', { kind: 'interval', everyMs: 3_600_000 }],
    ['cron', { kind: 'cron', cron: '0 9 * * *' }],
    ['event', { kind: 'event', eventType: 'job.failed' }],
  ])('rule legacy %s chuẩn hoá xong safeParse PASS', (_label, trigger) => {
    const parsed = AutomationRuleRecord.safeParse(normaliseAutomationDoc(legacyDoc(trigger)))

    expect(parsed.success).toBe(true)
  })

  test('idempotent trên doc legacy: normalise(normalise(x)) === normalise(x)', () => {
    for (const trigger of [
      { kind: 'time', at: '2026-03-04T05:06:07.000Z' },
      { kind: 'interval', everyMs: 3_600_000 },
      { kind: 'cron', cron: '0 9 * * *' },
      { kind: 'event', eventType: 'job.failed' },
    ]) {
      const once = normaliseAutomationDoc(legacyDoc(trigger))
      expect(normaliseAutomationDoc(once)).toEqual(once)
    }
  })

  test('trigger kind lạ chuẩn hoá xong safeParse FAIL (không lọt vào store)', () => {
    const parsed = AutomationRuleRecord.safeParse(normaliseAutomationDoc(legacyDoc({ kind: 'webhook', url: 'x' })))

    expect(parsed.success).toBe(false)
  })
})
