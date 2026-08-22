import { beforeEach, describe, expect, test } from 'bun:test'
import {
  evaluateScheduleTrigger,
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

describe('evaluateScheduleTrigger', () => {
  const now = new Date(2026, 7, 22, 12, 0, 0)

  test('time: due at/after `at`, only once', () => {
    const past = evaluateScheduleTrigger(
      { kind: 'time', at: '2026-08-22T10:00:00.000Z' },
      { lastRunAt: null },
      '2026-08-22T00:00:00.000Z',
      now,
    )
    expect(past.due).toBe(true)

    const fired = evaluateScheduleTrigger(
      { kind: 'time', at: '2026-08-22T10:00:00.000Z' },
      { lastRunAt: '2026-08-22T10:00:01.000Z', fired: true },
      '2026-08-22T00:00:00.000Z',
      now,
    )
    expect(fired.due).toBe(false)
    expect(fired.nextRunAt).toBeNull()

    const future = evaluateScheduleTrigger(
      { kind: 'time', at: '2026-08-23T10:00:00.000Z' },
      { lastRunAt: null },
      '2026-08-22T00:00:00.000Z',
      now,
    )
    expect(future.due).toBe(false)
    expect(future.nextRunAt).toBe('2026-08-23T10:00:00.000Z')
  })

  test('interval: first run waits a full interval after createdAt', () => {
    const created = '2026-08-22T11:00:00.000Z' // 1h trước now
    const every30m = evaluateScheduleTrigger(
      { kind: 'interval', everyMs: 30 * 60_000 },
      { lastRunAt: null },
      created,
      now,
    )
    expect(every30m.due).toBe(true)

    const every2h = evaluateScheduleTrigger(
      { kind: 'interval', everyMs: 2 * 3_600_000 },
      { lastRunAt: null },
      created,
      now,
    )
    expect(every2h.due).toBe(false)
  })

  test('interval: overdue slots coalesce to exactly one due run', () => {
    // Chạy cuối 6h trước, interval 30m → đã lỡ 12 slot; due một lần và
    // nextRun là slot vừa lỡ gần nhất (≤ now).
    const eval12 = evaluateScheduleTrigger(
      { kind: 'interval', everyMs: 30 * 60_000 },
      { lastRunAt: '2026-08-22T06:00:00.000Z' },
      '2026-08-22T00:00:00.000Z',
      now,
    )
    expect(eval12.due).toBe(true)
    expect(Date.parse(eval12.nextRunAt!)).toBeLessThanOrEqual(now.getTime())
    // Sau khi "chạy bù" (lastRunAt = now) → không due nữa.
    const afterCatchUp = evaluateScheduleTrigger(
      { kind: 'interval', everyMs: 30 * 60_000 },
      { lastRunAt: now.toISOString() },
      '2026-08-22T00:00:00.000Z',
      now,
    )
    expect(afterCatchUp.due).toBe(false)
  })

  test('cron: due when an occurrence passed since lastRunAt', () => {
    // 9h hằng ngày; chạy cuối hôm qua 9h → hôm nay 9h đã qua (now = 12h).
    const due = evaluateScheduleTrigger(
      { kind: 'cron', cron: '0 9 * * *' },
      { lastRunAt: new Date(2026, 7, 21, 9, 0).toISOString() },
      '2026-08-20T00:00:00.000Z',
      now,
    )
    expect(due.due).toBe(true)

    const notDue = evaluateScheduleTrigger(
      { kind: 'cron', cron: '0 9 * * *' },
      { lastRunAt: new Date(2026, 7, 22, 9, 0).toISOString() },
      '2026-08-20T00:00:00.000Z',
      now,
    )
    expect(notDue.due).toBe(false)
    expect(notDue.nextRunAt).toEqual(new Date(2026, 7, 23, 9, 0, 0).toISOString())
  })

  test('event trigger never due via scheduler', () => {
    const result = evaluateScheduleTrigger(
      { kind: 'event', eventType: 'job.failed' },
      { lastRunAt: null },
      '2026-08-20T00:00:00.000Z',
      now,
    )
    expect(result.due).toBe(false)
    expect(result.nextRunAt).toBeNull()
  })
})

beforeEach(() => {
  // matcher thuần — không state; giữ cho đồng bộ các file test.
})
