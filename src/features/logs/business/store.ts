import fs from 'node:fs/promises'
import { logFile } from '../../../core/log/fileDriver.js'
import { parseLogLine, type LogEntry, type LogType } from '../../../core/log/schema.js'

/**
 * Read log entries newest-first (feature UI). Write path sống ở `src/core/log`.
 * Missing file → []. Malformed lines are skipped. `limit` defaults to 200.
 */
export async function readLogs(opts: {
  type?: LogType
  project?: string | null
  limit?: number
} = {}): Promise<LogEntry[]> {
  const types: LogType[] = opts.type ? [opts.type] : ['request', 'audit']
  const out: LogEntry[] = []
  for (const t of types) {
    let raw: string
    try {
      raw = await fs.readFile(logFile(t), 'utf8')
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
