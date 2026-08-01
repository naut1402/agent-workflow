import { getLogDriver } from './driver.js'
import type { AuditEntity, AuditOp, LogEntry } from './schema.js'

/**
 * Append one entry via active log driver. Never throws —
 * logging must never break the caller.
 */
export async function appendLog(entry: LogEntry): Promise<void> {
  try {
    await getLogDriver().append(entry)
  } catch {
    /* swallow */
  }
}

function now(): { ts: number; iso: string } {
  const d = new Date()
  return { ts: d.getTime(), iso: d.toISOString() }
}

/** Record one `/api/*` request. Fire-and-forget. */
export function appendRequestLog(p: {
  method: string
  path: string
  projectId: string | null
  status: number
  durationMs: number
  error?: string | null
}): void {
  void appendLog({ type: 'request', ...now(), ...p, error: p.error ?? null }).catch(() => {})
}

/** Record one config mutation. Fire-and-forget; call only on the success path. */
export function emitAudit(p: {
  op: AuditOp
  entity: AuditEntity
  identifier: string | null
  projectId: string | null
  detail?: Record<string, unknown>
}): void {
  void appendLog({ type: 'audit', ...now(), ...p }).catch(() => {})
}
