/**
 * In-process event bus — nền cho automation (schedule / webhook / HITL).
 * Sync publish; handlers must not throw (errors are swallowed + logged).
 */

export type DashboardEventType =
  | 'job.queued'
  | 'job.started'
  | 'job.finished'
  | 'job.failed'
  | 'task.created'
  | 'task.advanced'
  | 'hitl.pending'
  | 'hitl.resolved'
  | 'webhook.received'
  | 'webhook.triggered'
  | 'usage.recorded'
  | string

export interface DashboardEvent<T = Record<string, unknown>> {
  type: DashboardEventType
  at: string
  payload: T
}

export type EventHandler = (event: DashboardEvent) => void | Promise<void>

const handlers = new Map<string, Set<EventHandler>>()
const anyHandlers = new Set<EventHandler>()

export function on(type: DashboardEventType | '*', handler: EventHandler): () => void {
  if (type === '*') {
    anyHandlers.add(handler)
    return () => {
      anyHandlers.delete(handler)
    }
  }
  let set = handlers.get(type)
  if (!set) {
    set = new Set()
    handlers.set(type, set)
  }
  set.add(handler)
  return () => {
    set!.delete(handler)
  }
}

export function once(type: DashboardEventType, handler: EventHandler): () => void {
  const off = on(type, async (event) => {
    off()
    await handler(event)
  })
  return off
}

export function emit(type: DashboardEventType, payload: Record<string, unknown> = {}): DashboardEvent {
  const event: DashboardEvent = {
    type,
    at: new Date().toISOString(),
    payload,
  }
  const run = (h: EventHandler) => {
    try {
      const r = h(event)
      if (r && typeof (r as Promise<void>).then === 'function') {
        ;(r as Promise<void>).catch((err) => {
          console.warn(`[event-bus] handler error for ${type}:`, err)
        })
      }
    } catch (err) {
      console.warn(`[event-bus] handler error for ${type}:`, err)
    }
  }
  for (const h of handlers.get(type) || []) run(h)
  for (const h of anyHandlers) run(h)
  return event
}

/** Clear all handlers — tests only. */
export function _resetEventBusForTest(): void {
  handlers.clear()
  anyHandlers.clear()
}

/** Stub registry for future schedule / webhook triggers (contract only). */
export type TriggerKind = 'schedule' | 'event' | 'webhook'

export interface TriggerRegistration {
  id: string
  kind: TriggerKind
  /** Event type to listen for (kind=event) or cron expression (kind=schedule). */
  match: string
  enabled: boolean
  meta?: Record<string, unknown>
}

const triggers = new Map<string, TriggerRegistration>()

export function registerTrigger(reg: TriggerRegistration): void {
  triggers.set(reg.id, reg)
}

export function unregisterTrigger(id: string): boolean {
  return triggers.delete(id)
}

export function listTriggers(): TriggerRegistration[] {
  return [...triggers.values()]
}

export function _resetTriggersForTest(): void {
  triggers.clear()
}
