/**
 * Port "chạy một automation rule" — hợp đồng giữa nơi kích hoạt
 * (`scheduler.ts` tick timer, `eventTrigger.ts` subscriber) và nơi thực thi
 * (`runAction.ts`). Nơi kích hoạt chỉ biết port này, nên unit-test của chúng
 * không kéo runner / monitor; `bootstrap.ts` bơm `runAutomation` thật vào lúc
 * nạp server.
 */

import type { AutomationRuleRecord } from '../schemas/automation.js'

export type AutomationRunSource = 'manual' | 'schedule' | 'event'

export interface AutomationRunnerInput {
  root: string
  projectId: string | null
  rule: AutomationRuleRecord
  source: AutomationRunSource
  /** Trigger khớp (schedule/event) — dựng context biến + đánh dấu fired. */
  triggerId?: string
  /** Payload event gốc khi source=event. */
  event?: { type: string; payload: Record<string, unknown> }
}

export type AutomationRunnerFn = (input: AutomationRunnerInput) => Promise<unknown> | unknown

/** Default noop — `bootstrap.ts` bơm `runAutomation` thật khi nạp server. */
let boundRunner: AutomationRunnerFn = async () => undefined

export function bindAutomationRunner(fn: AutomationRunnerFn): void {
  boundRunner = fn
}

export function getBoundAutomationRunner(): AutomationRunnerFn {
  return boundRunner
}
