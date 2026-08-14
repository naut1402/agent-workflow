/**
 * In-process event bus — nền cho automation (schedule / webhook / HITL).
 * Sync publish; handlers must not throw (errors are swallowed + logged).
 *
 * State lives on `globalThis` so Vite dev (plugin graph) + `import(fileURL)`
 * feature loaders share one bus. Module-local Maps would split: subscriber
 * registers on copy A while jobQueue `emit` hits copy B → Events tab stays empty.
 */

export type DashboardEventType =
  | 'job.queued'
  | 'job.started'
  | 'job.finished'
  | 'job.failed'
  | 'job.cancelled'
  | 'job.awaiting_recovery'
  | 'job.retry_scheduled'
  | 'job.recovered'
  | 'task.created'
  | 'task.advanced'
  | 'hitl.pending'
  | 'hitl.resolved'
  | 'entity.created'
  | 'entity.updated'
  | 'entity.deleted'
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

type BusState = {
  handlers: Map<string, Set<EventHandler>>
  anyHandlers: Set<EventHandler>
  triggers: Map<string, TriggerRegistration>
}

const BUS_KEY = '__devTeamDashboardEventBus__'

function busState(): BusState {
  const g = globalThis as typeof globalThis & { [BUS_KEY]?: BusState }
  if (!g[BUS_KEY]) {
    g[BUS_KEY] = {
      handlers: new Map(),
      anyHandlers: new Set(),
      triggers: new Map(),
    }
  }
  return g[BUS_KEY]
}

export function on(type: DashboardEventType | '*', handler: EventHandler): () => void {
  const { handlers, anyHandlers } = busState()
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
  const { handlers, anyHandlers } = busState()
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
  const { handlers, anyHandlers } = busState()
  handlers.clear()
  anyHandlers.clear()
}

/**
 * Stub registry for future schedule / webhook triggers.
 * Contract only — không auto-`on(match)` trong Epic D; wire runtime TBD (#193 follow-up).
 */
export type TriggerKind = 'schedule' | 'event' | 'webhook'

export interface TriggerRegistration {
  id: string
  kind: TriggerKind
  /** Event type to listen for (kind=event) or cron expression (kind=schedule). */
  match: string
  enabled: boolean
  meta?: Record<string, unknown>
}

export function registerTrigger(reg: TriggerRegistration): void {
  busState().triggers.set(reg.id, reg)
}

export function unregisterTrigger(id: string): boolean {
  return busState().triggers.delete(id)
}

export function listTriggers(): TriggerRegistration[] {
  return [...busState().triggers.values()]
}

export function _resetTriggersForTest(): void {
  busState().triggers.clear()
}
