import { beforeEach, describe, expect, test } from 'bun:test'
import {
  evaluateRuleTriggers,
  evaluateTimerTrigger,
  firedOnceTriggersAtRun,
  nextCronAfter,
  parseCronExpr,
} from '../../../../src/features/automations/business/matcher.js'

describe('parseCronExpr', () => {
  test('accepts common forms', () => {
    expect(parseCronExpr('* * * * *')).not.toBeNull()
    expect(parseCronExpr('*/15 * * * *')).not.toBeNull()
    expect(parseCronExpr('0 9 * * 1-5')).not.toBeNull()
    expect(parseCronExpr('30 2 1 1 *')).not.toBeNull()
    expect(parseCronExpr('0 0 1 jan,may *')).not.toBeNull()
    expect(parseCronExpr('0 12 * * sun')).not.toBeNull()
    expect(parseCronExpr('5,35 8-18 * * *')).not.toBeNull()
    expect(parseCronExpr('5/10 * * * *')).not.toBeNull()
  })

  test('rejects invalid forms', () => {
    expect(parseCronExpr('* * * *')).toBeNull() // 4 fields
    expect(parseCronExpr('* * * * * *')).toBeNull() // 6 fields
    expect(parseCronExpr('60 * * * *')).toBeNull() // minute out of range
    expect(parseCronExpr('* 24 * * *')).toBeNull() // hour out of range
    expect(parseCronExpr('* * 0 * *')).toBeNull() // dom out of range
    expect(parseCronExpr('* * * 13 *')).toBeNull() // month out of range
    expect(parseCronExpr('* * * * 8')).toBeNull() // dow out of range
    expect(parseCronExpr('a * * * *')).toBeNull()
    expect(parseCronExpr('*/0 * * * *')).toBeNull()
    expect(parseCronExpr('5-1 * * * *')).toBeNull()
  })

  test('dow 7 normalises to sunday (0)', () => {
    const spec = parseCronExpr('0 0 * * 7')
    expect(spec).not.toBeNull()
    expect(spec!.dow.set.has(0)).toBe(true)
    expect(spec!.dow.set.has(7)).toBe(false)
  })
})

describe('nextCronAfter', () => {
  // Dùng thời điểm cố định local: 2026-08-22T10:31:00 (thứ Bảy).
  const after = new Date(2026, 7, 22, 10, 31, 0)

  test('daily at 09:00 → next day (dom/dow wildcard)', () => {
    const next = nextCronAfter('0 9 * * *', after)
    expect(next).toEqual(new Date(2026, 7, 23, 9, 0, 0))
  })

  test('same-day later slot', () => {
    const next = nextCronAfter('45 10 * * *', after)
    expect(next).toEqual(new Date(2026, 7, 22, 10, 45, 0))
  })

  test('weekdays only (0 9 * * 1-5) skips the weekend', () => {
    // 2026-08-22 là thứ Bảy → kế tiếp là thứ Hai 24.
    const next = nextCronAfter('0 9 * * 1-5', after)
    expect(next).toEqual(new Date(2026, 7, 24, 9, 0, 0))
  })

  test('dom + dow both restricted → OR (vixie rule)', () => {
    // "1st OR every Monday" — 2026-08-22 (Sat) → thứ Hai 24 khớp dow.
    const next = nextCronAfter('0 9 1 * 1', after)
    expect(next).toEqual(new Date(2026, 7, 24, 9, 0, 0))
  })

  test('impossible schedule returns null within the search cap', () => {
    // 30/2 (ngày 30 tháng Hai) không bao giờ xảy ra.
    expect(nextCronAfter('0 0 30 2 *', after)).toBeNull()
  })

  test('strictly after — the reference minute itself is excluded', () => {
    const at = new Date(2026, 7, 22, 10, 31, 0)
    const next = nextCronAfter('31 10 * * *', at)
    expect(next).toEqual(new Date(2026, 7, 23, 10, 31, 0))
  })

  test('month name + step', () => {
    // 2026-08-22 → 2027-01-01 00:15
    const next = nextCronAfter('15 0 1 jan *', after)
    expect(next).toEqual(new Date(2027, 0, 1, 0, 15, 0))
  })

  test('invalid expr → null', () => {
    expect(nextCronAfter('nope * * * *', after)).toBeNull()
  })
})

describe('evaluateTimerTrigger (timer: once/interval/cron)', () => {
  const now = new Date(2026, 7, 22, 12, 0, 0)

  test('once: due at/after startAt, only once (triggerFired)', () => {
    const past = evaluateTimerTrigger(
      { id: 't1', kind: 'timer', startAt: '2026-08-22T10:00:00.000Z', repeat: { mode: 'once' } },
      { lastRunAt: null },
      now,
    )
    expect(past.due).toBe(true)

    const fired = evaluateTimerTrigger(
      { id: 't1', kind: 'timer', startAt: '2026-08-22T10:00:00.000Z', repeat: { mode: 'once' } },
      { lastRunAt: '2026-08-22T10:00:01.000Z', triggerFired: { t1: true } },
      now,
    )
    expect(fired.due).toBe(false)
    expect(fired.nextRunAt).toBeNull()

    const future = evaluateTimerTrigger(
      { id: 't1', kind: 'timer', startAt: '2026-08-23T10:00:00.000Z', repeat: { mode: 'once' } },
      { lastRunAt: null },
      now,
    )
    expect(future.due).toBe(false)
    expect(future.nextRunAt).toBe('2026-08-23T10:00:00.000Z')
  })

  test('interval: first run due exactly at startAt', () => {
    const atStart = evaluateTimerTrigger(
      { id: 't1', kind: 'timer', startAt: '2026-08-22T12:00:00.000Z', repeat: { mode: 'interval', everyMs: 30 * 60_000 } },
      { lastRunAt: null },
      now,
    )
    expect(atStart.due).toBe(true)

    const before = evaluateTimerTrigger(
      { id: 't1', kind: 'timer', startAt: '2026-08-22T12:30:00.000Z', repeat: { mode: 'interval', everyMs: 30 * 60_000 } },
      { lastRunAt: null },
      now,
    )
    expect(before.due).toBe(false)
    expect(before.nextRunAt).toBe('2026-08-22T12:30:00.000Z')
  })

  test('interval: next slot anchored on startAt grid after lastRunAt; missed slots coalesce', () => {
    // startAt 9:00, mỗi 30m; chạy cuối 11:00 → slot kế 11:30 ≤ now 12:00 → due.
    const due = evaluateTimerTrigger(
      { id: 't1', kind: 'timer', startAt: '2026-08-22T09:00:00.000Z', repeat: { mode: 'interval', everyMs: 30 * 60_000 } },
      { lastRunAt: '2026-08-22T11:00:00.000Z' },
      now,
    )
    expect(due.due).toBe(true)
    expect(due.nextRunAt).toBe('2026-08-22T11:30:00.000Z')

    // Chạy bù lúc 12:00 → slot kế 12:30, không due nữa.
    const afterCatchUp = evaluateTimerTrigger(
      { id: 't1', kind: 'timer', startAt: '2026-08-22T09:00:00.000Z', repeat: { mode: 'interval', everyMs: 30 * 60_000 } },
      { lastRunAt: '2026-08-22T12:00:00.000Z' },
      now,
    )
    expect(afterCatchUp.due).toBe(false)
    expect(afterCatchUp.nextRunAt).toBe('2026-08-22T12:30:00.000Z')
  })

  test('cron: due when an occurrence passed since lastRunAt (fallback startAt)', () => {
    const due = evaluateTimerTrigger(
      { id: 't1', kind: 'timer', startAt: new Date(2026, 7, 20).toISOString(), repeat: { mode: 'cron', expr: '0 9 * * *' } },
      { lastRunAt: new Date(2026, 7, 21, 9, 0).toISOString() },
      now,
    )
    expect(due.due).toBe(true)

    const notDue = evaluateTimerTrigger(
      { id: 't1', kind: 'timer', startAt: new Date(2026, 7, 20).toISOString(), repeat: { mode: 'cron', expr: '0 9 * * *' } },
      { lastRunAt: new Date(2026, 7, 22, 9, 0).toISOString() },
      now,
    )
    expect(notDue.due).toBe(false)
    expect(notDue.nextRunAt).toEqual(new Date(2026, 7, 23, 9, 0, 0).toISOString())
  })

  test('event trigger never due via scheduler evaluation', () => {
    const result = evaluateTimerTrigger(
      { id: 't1', kind: 'event', eventType: 'job.failed' },
      { lastRunAt: null },
      now,
    )
    expect(result.due).toBe(false)
  })
})

describe('evaluateRuleTriggers (OR qua nhiều trigger)', () => {
  const now = new Date(2026, 7, 22, 12, 0, 0)

  test('due khi một trong nhiều trigger due; nextRunAt = slot sớm nhất', () => {
    const evaluation = evaluateRuleTriggers(
      [
        { id: 't1', kind: 'timer', startAt: '2026-08-23T09:00:00.000Z', repeat: { mode: 'once' } },
        { id: 't2', kind: 'timer', startAt: '2026-08-22T08:00:00.000Z', repeat: { mode: 'interval', everyMs: 3_600_000 } },
        { id: 't3', kind: 'event', eventType: 'job.failed' },
      ],
      { lastRunAt: null },
      now,
    )
    expect(evaluation.due).toBe(true)
    expect(evaluation.dueTriggerIds).toEqual(['t2'])
    expect(evaluation.nextRunAt).toBe('2026-08-22T08:00:00.000Z')
  })

  test('firedOnceTriggersAtRun: chỉ đánh dấu once đã qua startAt', () => {
    const fired = firedOnceTriggersAtRun(
      [
        { id: 't1', kind: 'timer', startAt: '2026-08-20T00:00:00.000Z', repeat: { mode: 'once' } },
        { id: 't2', kind: 'timer', startAt: '2026-08-30T00:00:00.000Z', repeat: { mode: 'once' } },
        { id: 't3', kind: 'timer', startAt: '2026-08-20T00:00:00.000Z', repeat: { mode: 'interval', everyMs: 60_000 } },
      ],
      now,
    )
    expect(fired).toEqual({ t1: true })
  })
})

