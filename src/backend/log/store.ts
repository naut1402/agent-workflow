import { nowStamp } from '../lib/dateUtils.js'
import { getLogDriver } from './driver.js'
import { isLogTypeEnabled } from './loggingPrefsIo.js'
import {
  levelFromHttpStatus,
  type AuditEntity,
  type AuditOp,
  type LogEntry,
  type LogLevel,
  type ToolCallLogEntry,
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
    if (entry.type === 'tool-call' && !isLogTypeEnabled('tool-call')) return
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

/**
 * Record the tool calls of one finished job. Opt-in (`logging.types['tool-call']`).
 * Resolves even when the type is off or the driver throws — ingest is bookkeeping
 * and must never surface as a job failure.
 *
 * `ts` is optional and defaults to now, which is right for the runtime path: the
 * job just ended. BACKFILL must pass the job's own finish time instead. Stamping
 * historical entries with the clock collapses months of history into the few
 * hundred milliseconds the import took, which makes `--from`/`--to` meaningless
 * and silently folds pre-MCP history into the `mcpAdoption.share` measurement that
 * decides whether `search_code` gets built.
 */
export function appendToolCallLog(
  p: Omit<ToolCallLogEntry, 'type' | 'ts' | 'iso' | 'level' | 'traceId'> & {
    ts?: number
    level?: LogLevel
    traceId?: string | null
  },
): Promise<void> {
  if (!isLogTypeEnabled('tool-call')) return Promise.resolve()
  const level = p.level ?? 'info'
  const traceId = (p.traceId ?? getTraceId() ?? '').trim()
  const { ts: _ts, level: _l, traceId: _t, ...rest } = p
  const stamp =
    typeof p.ts === 'number' && Number.isFinite(p.ts)
      ? { ts: p.ts, iso: new Date(p.ts).toISOString() }
      : nowStamp()
  return appendLog({
    type: 'tool-call',
    ...stamp,
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
