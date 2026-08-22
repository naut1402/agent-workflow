import { and, desc, eq, inArray } from 'drizzle-orm'
import { getDb } from '../../../core/db/client.js'
import { logEntries } from '../../../core/db/schema.js'
import { readTextFile } from '../../../core/lib/fileHelper.js'
import { activeLogDriverKind } from '../../../core/log/driver.js'
import { logFile } from '../../../core/log/fileDriver.js'
import { isLogTypeEnabled } from '../../../core/log/loggingPrefsIo.js'
import { parseLogLine, type LogEntry, type LogType } from '../../../core/log/schema.js'

type ReadLogsOpts = { type?: LogType; project?: string | null; limit?: number }

/** SQLite read path — mirrors the file path's filter/sort/limit semantics exactly. */
function readLogsFromSqlite(types: LogType[], opts: ReadLogsOpts): LogEntry[] {
  const enabledTypes = types.filter((t) => isLogTypeEnabled(t))
  if (!enabledTypes.length) return []
  try {
    const conditions = [inArray(logEntries.type, enabledTypes)]
    if (opts.project !== undefined && opts.project !== null) {
      conditions.push(eq(logEntries.projectId, opts.project))
    }
    const rows = getDb()
      .select()
      .from(logEntries)
      .where(and(...conditions))
      .orderBy(desc(logEntries.ts))
      .limit(opts.limit ?? 200)
      .all()
    const out: LogEntry[] = []
    for (const row of rows) {
      const entry = parseLogLine(row.payload)
      if (entry) out.push(entry)
    }
    return out
  } catch {
    return []
  }
}

/**
 * Read log entries newest-first (feature UI). Write path sống ở `src/core/log`.
 * Missing file → []. Malformed lines are skipped. `limit` defaults to 200.
 * Disabled types (settings) → skipped / empty.
 * Read backend follows the active log driver (`logging.driver` — file or sqlite).
 */
export async function readLogs(opts: ReadLogsOpts = {}): Promise<LogEntry[]> {
  const types: LogType[] = opts.type ? [opts.type] : ['request', 'audit', 'usage']
  if (activeLogDriverKind() === 'sqlite') return readLogsFromSqlite(types, opts)
  const out: LogEntry[] = []
  for (const t of types) {
    if (!isLogTypeEnabled(t)) continue
    let raw: string
    try {
      raw = await readTextFile(logFile(t))
    } catch {
      continue
    }
    for (const line of raw.split('\n')) {
      const entry = parseLogLine(line)
      if (!entry) continue
      if (opts.project !== undefined && opts.project !== null && entry.projectId !== opts.project) continue
      out.push(entry)
    }
  }
  out.sort((a, b) => b.ts - a.ts)
  return out.slice(0, opts.limit ?? 200)
}

// Re-export write helpers so existing `logs/business` imports keep working.
export { appendLog, appendRequestLog, emitAudit } from '../../../core/log/store.js'
