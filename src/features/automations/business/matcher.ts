/**
 * Pure trigger matching cho automations (#233): cron 5-field, interval, one-shot.
 * Không fs / không HTTP — unit-test trực tiếp.
 *
 * Cron theo local timezone (Date getter local), ngữ nghĩa Unix vixie-cron:
 * - field: `*`, bước-n (`*` chia n, a-b chia n), `a`, `a-b`, list `a,b,c`;
 *   month/dow nhận tên viết tắt (jan..dec, sun..sat).
 * - dom + dow cùng bị giới hạn → OR (chuẩn cron), còn lại AND.
 */

import type { AutomationTrigger } from '../schemas/automation.js'

export interface CronField {
  /** Giá trị hợp lệ (đã resolve tên / 7→0 cho dow). */
  set: Set<number>
  /** Field là `*` — cần cho luật dom/dow. */
  wildcard: boolean
}

export interface CronSpec {
  minute: CronField
  hour: CronField
  dom: CronField
  month: CronField
  dow: CronField
}

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const DOW_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

function tokenToValue(token: string, min: number, max: number, names?: string[]): number | null {
  if (names) {
    const idx = names.indexOf(token.toLowerCase())
    if (idx >= 0) return min === 0 ? idx % 7 : idx + min
  }
  if (!/^\d+$/.test(token)) return null
  const v = Number(token)
  if (v < min || v > max) return null
  return v
}

function parseField(
  field: string,
  min: number,
  max: number,
  names?: string[],
): CronField | null {
  const set = new Set<number>()
  let wildcard = false
  for ( const part of field.split(',')) {
    const [rangePart, stepPart] = part.split('/')
    const step = stepPart === undefined ? 1 : Number(stepPart)
    if (!Number.isInteger(step) || step < 1) return null

    let lo: number
    let hi: number
    if (rangePart === '*') {
      // `*` và `*/n` (kể cả `*/1`) đều hợp lệ — wildcard chỉ khi bare `*`.
      lo = min
      hi = max
      if (part === '*') wildcard = true
    } else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-')
      const av = tokenToValue(a, min, max, names)
      const bv = tokenToValue(b, min, max, names)
      if (av === null || bv === null || av > bv) return null
      lo = av
      hi = bv
    } else {
      const v = tokenToValue(rangePart, min, max, names)
      if (v === null) return null
      // `a/n` của cron = bắt đầu từ a, bước n đến max.
      lo = v
      hi = stepPart !== undefined ? max : v
    }
    for (let v = lo; v <= hi; v += step) set.add(v)
  }
  if (set.size === 0) return null
  return { set, wildcard }
}

/** Parse biểu thức cron 5 field → CronSpec, hoặc null nếu không hợp lệ. */
export function parseCronExpr(expr: string): CronSpec | null {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const minute = parseField(fields[0], 0, 59)
  const hour = parseField(fields[1], 0, 23)
  const dom = parseField(fields[2], 1, 31)
  const month = parseField(fields[3], 1, 12, MONTH_NAMES)
  // dow 0-7, 7 ≡ 0 (Chủ nhật) — chuẩn hoá về 0-6.
  const dowRaw = parseField(fields[4], 0, 7, DOW_NAMES)
  if (!minute || !hour || !dom || !month || !dowRaw) return null
  const dowSet = new Set<number>()
  for (const v of dowRaw.set) dowSet.add(v % 7)
  const dow: CronField = { set: dowSet, wildcard: dowRaw.wildcard }
  return { minute, hour, dom, month, dow }
}

function matchesDay(spec: CronSpec, d: Date): boolean {
  const domOk = spec.dom.set.has(d.getDate())
  const dowOk = spec.dow.set.has(d.getDay())
  // Vixie-cron: cả hai cùng restrict → OR; chỉ một restrict → field đó phải khớp.
  const domRestricted = !spec.dom.wildcard
  const dowRestricted = !spec.dow.wildcard
  if (domRestricted && dowRestricted) return domOk || dowOk
  if (domRestricted) return domOk
  if (dowRestricted) return dowOk
  return true
}

const MINUTE_MS = 60_000

/**
 * Lần khớp cron đầu tiên **sau** thời điểm `after` (local tz), hoặc null khi
 * không có lần nào trong tầm tìm (tối đa ~4 năm — chặn lịch không thể khớp
 * như "31 2 30 2 *").
 */
export function nextCronAfter(expr: string, after: Date): Date | null {
  const spec = parseCronExpr(expr)
  if (!spec) return null

  // Duyệt theo ngày (rẻ), trong ngày duyệt giờ/phút của field set (đã sắp xếp).
  const hours = [...spec.hour.set].sort((a, b) => a - b)
  const minutes = [...spec.minute.set].sort((a, b) => a - b)

  const start = new Date(after.getTime() + MINUTE_MS)
  start.setSeconds(0, 0)
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate())

  const dayMatches = (d: Date) => spec.month.set.has(d.getMonth() + 1) && matchesDay(spec, d)

  for (let day = 0; day <= 366 * 4; day++) {
    if (dayMatches(cursor)) {
      for (const h of hours) {
        for (const m of minutes) {
          const candidate = new Date(
            cursor.getFullYear(),
            cursor.getMonth(),
            cursor.getDate(),
            h,
            m,
            0,
            0,
          )
          if (candidate.getTime() > after.getTime()) return candidate
        }
      }
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  return null
}

// ── Đánh giá trigger thời gian (due + next-run) ─────────────────────────────

export interface TriggerRuntimeState {
  /** Lần chạy gần nhất của rule (ISO) — null khi chưa chạy lần nào. */
  lastRunAt: string | null
  /** Trigger id one-shot `once` đã chạy (không chạy lại). */
  triggerFired?: Record<string, boolean>
}

export interface TriggerEvaluation {
  due: boolean
  /** Lần chạy kế tiếp (ISO) để UI hiển thị — null khi không còn (one-shot đã chạy). */
  nextRunAt: string | null
}

/**
 * Đánh giá một trigger **thời gian** tại `now` — mọi mode cùng mốc `startAt`:
 * - `once`: due đúng một lần khi tới `startAt` và chưa fired.
 * - `interval`: slot chạy = startAt + k·everyMs. Lần đầu due tại `startAt`;
 *   sau mỗi lần chạy, slot kế = slot liền sau `lastRunAt`. Downtime lỡ nhiều
 *   slot → **chạy bù đúng một lần** rồi tính lại.
 * - `cron`: lần khớp đầu tiên sau `lastRunAt` (hoặc `startAt` nếu chưa chạy);
 *   downtime lỡ nhiều lịch → chạy bù một lần.
 */
export function evaluateTimerTrigger(
  trigger: AutomationTrigger,
  state: TriggerRuntimeState,
  now: Date,
): TriggerEvaluation {
  if (trigger.kind !== 'timer') return { due: false, nextRunAt: null }

  const startAt = Date.parse(trigger.startAt)
  if (Number.isNaN(startAt)) return { due: false, nextRunAt: null }
  const lastRun = state.lastRunAt ? Date.parse(state.lastRunAt) : null

  if (trigger.repeat.mode === 'once') {
    if (state.triggerFired?.[trigger.id]) return { due: false, nextRunAt: null }
    return { due: now.getTime() >= startAt, nextRunAt: new Date(startAt).toISOString() }
  }

  if (trigger.repeat.mode === 'interval') {
    const everyMs = trigger.repeat.everyMs
    if (everyMs <= 0) return { due: false, nextRunAt: null }
    // Slot kế = slot đầu tiên còn nằm sau lần chạy gần nhất (chưa chạy → startAt).
    let next: number
    if (lastRun === null || Number.isNaN(lastRun)) {
      next = startAt
    } else {
      const k = Math.floor((lastRun - startAt) / everyMs) + 1
      next = startAt + k * everyMs
    }
    return { due: next <= now.getTime(), nextRunAt: new Date(next).toISOString() }
  }

  // cron — ref = lastRunAt ?? startAt
  const refRaw = state.lastRunAt ?? trigger.startAt
  const ref = Date.parse(refRaw)
  if (Number.isNaN(ref)) return { due: false, nextRunAt: null }
  const next = nextCronAfter(trigger.repeat.expr, new Date(ref))
  if (!next) return { due: false, nextRunAt: null }
  return { due: next.getTime() <= now.getTime(), nextRunAt: next.toISOString() }
}

export interface RuleTriggerEvaluation {
  due: boolean
  /** Slot gần nhất trong các trigger thời gian (UI hiển thị). */
  nextRunAt: string | null
  /** Trigger timer đang due (để đánh dấu fired khi run bắt đầu). */
  dueTriggerIds: string[]
}

/**
 * Đánh giá toàn bộ trigger của rule tại `now`: rule due khi **bất kỳ** trigger
 * thời gian nào due (event trigger do subscriber xử, không due theo tick).
 */
export function evaluateRuleTriggers(
  triggers: AutomationTrigger[],
  state: TriggerRuntimeState,
  now: Date,
): RuleTriggerEvaluation {
  let due = false
  let nextRunAt: string | null = null
  const dueTriggerIds: string[] = []
  for (const trigger of triggers) {
    if (trigger.kind !== 'timer') continue
    const evaluation = evaluateTimerTrigger(trigger, state, now)
    if (evaluation.nextRunAt && (!nextRunAt || evaluation.nextRunAt < nextRunAt)) {
      nextRunAt = evaluation.nextRunAt
    }
    if (evaluation.due) {
      due = true
      dueTriggerIds.push(trigger.id)
    }
  }
  return { due, nextRunAt, dueTriggerIds }
}

/**
 * Trigger one-shot `once` đã qua `startAt` coi như đã kích hoạt khi rule chạy
 * (kể cả khi run fail thì không chạy lại) — trả về state map cần merge.
 */
export function firedOnceTriggersAtRun(
  triggers: AutomationTrigger[],
  now: Date,
): Record<string, boolean> {
  const fired: Record<string, boolean> = {}
  for (const trigger of triggers) {
    if (trigger.kind !== 'timer' || trigger.repeat.mode !== 'once') continue
    const startAt = Date.parse(trigger.startAt)
    if (!Number.isNaN(startAt) && now.getTime() >= startAt) fired[trigger.id] = true
  }
  return fired
}
