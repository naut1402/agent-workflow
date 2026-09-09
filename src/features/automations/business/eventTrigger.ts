/**
 * Trigger theo domain event (#233): một subscriber wildcard duy nhất trên event
 * bus, mỗi event đối chiếu rule `kind: event` của mọi project.
 *
 * - Match khi `event.payload.projectId` **bằng** project của rule — event không
 *   mang projectId không khớp rule nào (tránh chạy chéo project).
 * - Bỏ qua `automation.*` chính nó — chống vòng lặp rule → run → event → rule.
 * - Coalesce: bỏ qua khi rule đang inFlight hoặc vừa chạy trong
 *   `MIN_EVENT_REFIRE_MS` (10s) — chặn storm job.* liên tiếp.
 */

import { on, type DashboardEvent } from '../../../core/events/index.js'
import { loadRegistry } from '../../../core/registry.js'
import { getRuleState } from './runLedger.js'
import { listAutomations } from './rules.js'
import { getBoundAutomationRunner } from './scheduler.js'

export const MIN_EVENT_REFIRE_MS = 10_000

let triggersStarted = false

export function isAutomationFeedbackEvent(type: string): boolean {
  return type === 'automation.triggered' || type.startsWith('automation.run_')
}

/**
 * Đối chiếu một event với mọi rule `kind: event` của project phát event.
 * Export để test trực tiếp (deterministic) — subscription thật ở
 * `startEventTriggers`.
 */
export async function handleEvent(event: DashboardEvent): Promise<void> {
  if (isAutomationFeedbackEvent(event.type)) return

  const payloadProjectId = event.payload?.projectId
  if (typeof payloadProjectId !== 'string' || !payloadProjectId) return

  const { projects } = loadRegistry()
  const project = projects.find((p) => p.id === payloadProjectId)
  if (!project) return

  const run = getBoundAutomationRunner()
  for (const rule of listAutomations(project.path)) {
    if (!rule.enabled) continue
    // Nhiều trigger: khớp **bất kỳ** trigger event nào của rule.
    const matched = rule.triggers.find(
      (t) => t.kind === 'event' && t.eventType === event.type,
    )
    if (!matched) continue

    const state = getRuleState(project.id, rule.id)
    if (state.inFlight) continue
    if (
      state.lastRunAt &&
      Date.now() - Date.parse(state.lastRunAt) < MIN_EVENT_REFIRE_MS
    ) {
      continue
    }

    try {
      await run({
        root: project.path,
        projectId: project.id,
        rule,
        source: 'event',
        triggerId: matched.id,
        event: { type: event.type, payload: event.payload ?? {} },
      })
    } catch (err) {
      console.warn(`[automations] event run failed for ${project.id}:${rule.id}:`, err)
    }
  }
}

/** Đăng ký subscriber — idempotent (module có thể bị nạp lại trong dev). */
export function startEventTriggers(): void {
  if (triggersStarted) return
  triggersStarted = true
  on('*', (event) => {
    void handleEvent(event)
  })
}

/** Tests only. */
export function _resetEventTriggersForTest(): void {
  triggersStarted = false
}
