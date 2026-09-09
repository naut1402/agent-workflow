/**
 * Biến tham chiếu giữa trigger ↔ các bước action (#233):
 * - `{{trigger.kind}}`, `{{trigger.type}}`, `{{trigger.payload.<path>}}` —
 *   context trigger (event mang payload gốc; timer mang lịch).
 * - `{{steps.N.taskId}}`, `{{steps.N.jobId}}`, `{{steps.N.status}}`,
 *   `{{steps.N.stdout}}`, `{{steps.N.artifacts.<name>}}` — output bước thứ N
 *   (N bắt đầu từ 1, theo thứ tự actions).
 *
 * Pure — unit-test trực tiếp. Path không tra được → giữ nguyên literal để dễ
 * nhận ra trong output thay vì im lặng thay bằng rỗng.
 */

import type { AutomationRun, AutomationStepResult } from '../schemas/automation.js'

export interface TriggerContext {
  kind: 'event' | 'timer' | 'manual'
  /** Event type gốc (kind=event) hoặc biểu thức lặp (kind=timer). */
  type?: string
  payload: Record<string, unknown>
}

export type StepContext = AutomationStepResult

export interface AutomationVarsContext {
  trigger: TriggerContext
  /** steps[0] = action 1 — index 1-based qua path `steps.N`. */
  steps: StepContext[]
}

const VAR_PATTERN = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g

/** Tra path `a.b.0.c` vào object — trả undefined khi lệch. */
export function lookupPath(ctx: unknown, path: string): unknown {
  const parts = path.split('.')
  let cur: unknown = ctx
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined
    if (Array.isArray(cur)) {
      const idx = Number(part)
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return undefined
      cur = cur[idx]
      continue
    }
    if (typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

/** Thay mọi `{{path}}` trong chuỗi bằng giá trị từ context (lệch → giữ nguyên). */
export function substituteVars(input: string, ctx: AutomationVarsContext): string {
  return input.replace(VAR_PATTERN, (match, path: string) => {
    // `steps.N` là 1-based theo doc — map về index mảng 0-based.
    const normalised = path.replace(/^steps\.(\d+)(\.|$)/, (_m, n: string, rest: string) =>
      `steps.${Number(n) - 1}${rest}`,
    )
    const value = lookupPath(ctx, normalised)
    return value === undefined ? match : stringify(value)
  })
}

/** Object nào có trường string thì thay — không đụng field khác. */
export function substituteVarsInRecord<T extends Record<string, unknown>>(
  record: T,
  keys: Array<keyof T & string>,
  ctx: AutomationVarsContext,
): T {
  const out: Record<string, unknown> = { ...record }
  for (const key of keys) {
    const v = record[key]
    if (typeof v === 'string' && v.includes('{{')) out[key] = substituteVars(v, ctx)
  }
  return out as T
}

/**
 * Context biến dạng "schema" cho form tooltip: cấu trúc biến có thể dùng tại
 * vị trí bước `stepIndex` (1-based) — trigger + các bước trước nó, value là
 * ví dụ dạng (không phải dữ liệu run thật).
 */
export function varsSkeletonForStep(stepIndex: number, hasEventTrigger: boolean): AutomationVarsContext {
  const trigger: TriggerContext = hasEventTrigger
    ? { kind: 'event', type: '<event-type>', payload: { '<field>': '…' } }
    : {
        kind: 'timer',
        type: '<once|interval|cron>',
        payload: { startAt: '<ISO>', everyMs: 60000, expr: '0 9 * * *' },
      }
  const steps: StepContext[] = []
  for (let i = 1; i < stepIndex; i++) {
    steps.push({
      index: i,
      name: `<bước ${i}>`,
      taskId: '<task-id>',
      jobId: '<job-id>',
      status: 'succeeded',
      stdout: '<stdout của job>',
      artifacts: { '<artifact>': '<nội dung markdown>' },
    })
  }
  return { trigger, steps }
}

/** Context thật sau run — cho history UI hiển thị steps JSON. */
export function contextOfRun(run: AutomationRun): AutomationVarsContext | null {
  if (!run.steps?.length) return null
  return { trigger: { kind: 'manual', payload: {} }, steps: run.steps }
}
