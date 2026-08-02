import { nowStamp } from '../lib/dateUtils.js'
import { getLogDriver } from './driver.js'
import { isLogTypeEnabled } from './loggingPrefs.js'
import type { AuditEntity, AuditOp, LogEntry } from './schema.js'

/**
 * Append one entry via active log driver. Never throws —
 * logging must never break the caller. Respects logging prefs (settings.json).
 */
export async function appendLog(entry: LogEntry): Promise<void> {
  try {
    if (entry.type === 'request' && !isLogTypeEnabled('request')) return
    if (entry.type === 'audit' && !isLogTypeEnabled('audit')) return
    await getLogDriver().append(entry)
  } catch {
    /* swallow */
  }
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
  if (!isLogTypeEnabled('request')) return
  void appendLog({ type: 'request', ...nowStamp(), ...p, error: p.error ?? null }).catch(() => {})
}

/** Record one config mutation. Fire-and-forget; call only on the success path. */
export function emitAudit(p: {
  op: AuditOp
  entity: AuditEntity
  identifier: string | null
  projectId: string | null
  detail?: Record<string, unknown>
}): void {
  if (!isLogTypeEnabled('audit')) return
  void appendLog({ type: 'audit', ...nowStamp(), ...p }).catch(() => {})
}
