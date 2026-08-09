/**
 * Persist domain bus events to `events.jsonl` when `logging.types.events` is on.
 * Part of observability (#195 read UI + #196 write path).
 */
import { on, type DashboardEvent } from '../events/eventBus.js'
import { nowStamp } from '../lib/dateUtils.js'
import { isLogTypeEnabled } from './loggingPrefs.js'
import { LOG_RESPONSE_MAX_CHARS, truncateForLog } from './schema.js'
import { appendLog } from './store.js'
import { getTraceId } from './traceContext.js'

const SENSITIVE_KEY_RE = /(token|pat|secret|password|api[-_]?key|authorization)/i

let uninstall: (() => void) | null = null

function redactPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactPayload)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY_RE.test(k) ? '[redacted]' : redactPayload(v)
    }
    return out
  }
  return value
}

/** Bound + redact payload so JSONL stays small and free of secrets. */
export function prepareEventPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const redacted = redactPayload(payload) as Record<string, unknown>
  try {
    const raw = JSON.stringify(redacted)
    if (raw.length <= LOG_RESPONSE_MAX_CHARS) return redacted
    return { _truncated: true, preview: truncateForLog(raw, LOG_RESPONSE_MAX_CHARS) }
  } catch {
    return { _error: 'payload_not_serializable' }
  }
}

function projectIdFromPayload(payload: Record<string, unknown>): string | null {
  const p = payload.projectId
  return typeof p === 'string' && p.trim() ? p : null
}

export function appendEventLog(event: DashboardEvent): void {
  if (!isLogTypeEnabled('events')) return
  const payload =
    event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
      ? prepareEventPayload(event.payload as Record<string, unknown>)
      : {}
  const traceId = (getTraceId() ?? '').trim()
  void appendLog({
    type: 'events',
    ...nowStamp(),
    level: 'info',
    traceId,
    event: String(event.type || ''),
    payload,
    projectId: projectIdFromPayload(payload),
  }).catch(() => {})
}

function onDomainEvent(event: DashboardEvent): void {
  appendEventLog(event)
}

/** Idempotent for production; rebinds after bus reset in tests. */
export function installEventLogSubscriber(): void {
  uninstallEventLogSubscriberForTest()
  uninstall = on('*', onDomainEvent)
}

/** Tests only — remove wildcard handler after `_resetEventBusForTest`. */
export function uninstallEventLogSubscriberForTest(): void {
  if (uninstall) {
    uninstall()
    uninstall = null
  }
}
