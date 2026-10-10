import { nowStamp } from '../lib/dateUtils.js'
import { logQueryTypes, type LogQuery } from './driver.js'
import { getLogDriver } from './driverInit.js'
import { isLogTypeEnabled } from './loggingPrefsIo.js'
import {
  levelFromHttpStatus,
  type AuditEntity,
  type AuditOp,
  type LogEntry,
  type LogLevel,
  type LogType,
  type UsageLogEntry,
} from '../../shared/log/schema.js'
import { getTraceId } from './traceContext.js'

/**
 * Append one entry via active log driver. Never throws —
 * logging must never break the caller. Respects logging prefs (settings.json).
 */
export async function appendLog(entry: LogEntry): Promise<void> {
  try {
    if (entry.type === 'request' && !isLogTypeEnabled('request')) return
    if (entry.type === 'audit' && !isLogTypeEnabled('audit')) return
    if (entry.type === 'events' && !isLogTypeEnabled('events')) return
    if (entry.type === 'usage' && !isLogTypeEnabled('usage')) return
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
  level?: LogLevel
  traceId?: string | null
  query?: string | null
  response?: string | null
}): void {
  if (!isLogTypeEnabled('request')) return
  const level = p.level ?? levelFromHttpStatus(p.status)
  const traceId = (p.traceId ?? getTraceId() ?? '').trim()
  void appendLog({
    type: 'request',
    ...nowStamp(),
    level,
    traceId,
    method: p.method,
    path: p.path,
    query: p.query ?? '',
    response: p.response ?? '',
    projectId: p.projectId,
    status: p.status,
    durationMs: p.durationMs,
    error: p.error ?? null,
  }).catch(() => {})
}

/** Record one job token-usage snapshot. Fire-and-forget when not awaited. */
export function appendUsageLog(
  p: Omit<UsageLogEntry, 'type' | 'ts' | 'iso' | 'level' | 'traceId'> & {
    level?: LogLevel
    traceId?: string | null
  },
): Promise<void> {
  if (!isLogTypeEnabled('usage')) return Promise.resolve()
  const level = p.level ?? 'info'
  const traceId = (p.traceId ?? getTraceId() ?? '').trim()
  const { level: _l, traceId: _t, ...rest } = p
  return appendLog({
    type: 'usage',
    ...nowStamp(),
    level,
    traceId,
    ...rest,
  }).catch(() => {})
}

/** Record one config mutation. Fire-and-forget; call only on the success path. */
export function emitAudit(p: {
  op: AuditOp
  entity: AuditEntity
  identifier: string | null
  projectId: string | null
  detail?: Record<string, unknown>
  level?: LogLevel
  traceId?: string | null
}): void {
  if (!isLogTypeEnabled('audit')) return
  const level = p.level ?? 'info'
  const traceId = (p.traceId ?? getTraceId() ?? '').trim()
  void appendLog({
    type: 'audit',
    ...nowStamp(),
    level,
    traceId,
    op: p.op,
    entity: p.entity,
    identifier: p.identifier,
    projectId: p.projectId,
    ...(p.detail ? { detail: p.detail } : {}),
  }).catch(() => {})
}

/**
 * Read entries newest-first via the active log driver — the single place on the read
 * path that drops disabled types (settings). Every type disabled → `[]` without touching
 * the driver. Never throws: a failing driver reads as "no logs".
 */
export async function queryLogs(q: LogQuery): Promise<LogEntry[]> {
  const types = logQueryTypes(q).filter((t) => isLogTypeEnabled(t))
  if (!types.length) return []
  try {
    return await getLogDriver().query({ ...q, type: types })
  } catch {
    return []
  }
}

/**
 * Store revision of `type` on the active driver, for read-side caching. `null` = do not
 * cache: type disabled, driver has no `revision` hook, or the hook failed.
 */
export async function logRevision(type: LogType): Promise<string | null> {
  if (!isLogTypeEnabled(type)) return null
  const driver = getLogDriver()
  if (!driver.revision) return null
  try {
    return await driver.revision(type)
  } catch {
    return null
  }
}
