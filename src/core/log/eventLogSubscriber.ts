/**
 * Persist domain bus events to JSONL when `logging.types.events` is on.
 * Register once at API boot (`createApp`); idempotent.
 */
import { on, type DashboardEvent } from '../events/eventBus.js'
import { nowStamp } from '../lib/dateUtils.js'
import { isLogTypeEnabled } from './loggingPrefs.js'
import { LOG_RESPONSE_MAX_CHARS, truncateForLog } from './schema.js'
import { appendLog } from './store.js'
import { getTraceId } from './traceContext.js'

let unsubscribe: (() => void) | null = null

function resolveProjectId(payload: Record<string, unknown>): string | null {
  if (!('projectId' in payload)) return null
  const p = payload.projectId
  if (typeof p === 'string') return p
  if (p == null) return null
  return String(p)
}

function boundPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const serialized = JSON.stringify(payload)
  if (serialized.length <= LOG_RESPONSE_MAX_CHARS) return payload
  const clipped = truncateForLog(serialized, LOG_RESPONSE_MAX_CHARS)
  try {
    return JSON.parse(clipped) as Record<string, unknown>
  } catch {
    return { _truncated: clipped }
  }
}

function onDomainEvent(event: DashboardEvent): void {
  if (!isLogTypeEnabled('events')) return
  const raw =
    event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
      ? (event.payload as Record<string, unknown>)
      : {}
  void appendLog({
    type: 'events',
    ...nowStamp(),
    level: 'info',
    traceId: (getTraceId() ?? '').trim(),
    event: event.type,
    payload: boundPayload(raw),
    projectId: resolveProjectId(raw),
  }).catch(() => {})
}

/** Subscribe wildcard handler once. Safe to call from createApp repeatedly. */
export function registerEventLogSubscriber(): void {
  if (unsubscribe) return
  unsubscribe = on('*', onDomainEvent)
}

/** Tests only — drop handler so suites can re-register cleanly. */
export function _resetEventLogSubscriberForTest(): void {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
}
