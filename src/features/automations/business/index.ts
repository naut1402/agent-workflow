/**
 * Public business surface cho automations. Controller + cross-feature
 * (nl-chat draft confirm) import từ đây.
 *
 * Nạp qua api.ts: bơm runner thật + khởi động scheduler/event subscriber,
 * trừ khi `bun test` (test tự điều khiển tick / bind stub runner).
 */

import { bindAutomationRunner, startAutomationScheduler } from './scheduler.js'
import { startEventTriggers } from './eventTrigger.js'
import { runAutomation } from './runAction.js'

export * from './matcher.js'
export * from '../lib/vars.js'
export * from './rules.js'
export * from './runLedger.js'
export * from './runAction.js'
export * from './scheduler.js'
export * from './eventTrigger.js'

/** Sự kiện có thể chọn làm trigger trong UI (từ event-catalog, trừ `automation.*` tự phát). */
export const KNOWN_AUTOMATION_EVENT_TYPES: string[] = [
  'job.queued',
  'job.started',
  'job.finished',
  'job.failed',
  'job.cancelled',
  'job.awaiting_recovery',
  'job.retry_scheduled',
  'job.recovered',
  'task.created',
  'task.advanced',
  'hitl.pending',
  'hitl.resolved',
  'entity.created',
  'entity.updated',
  'entity.deleted',
  'webhook.received',
  'webhook.triggered',
  'usage.recorded',
  'orchestrator.dispatched',
  'orchestrator.halted',
  'orchestrator.start_requested',
]

if (!process.env.BUN_TEST) {
  bindAutomationRunner(runAutomation)
  startAutomationScheduler()
  startEventTriggers()
}
