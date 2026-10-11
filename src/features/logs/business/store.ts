import { queryLogs, type LogEntry, type LogType } from '../../../backend/log/index.js'

type ReadLogsOpts = { type?: LogType; project?: string | null; limit?: number }

const DEFAULT_LIMIT = 200

/** Type đọc khi không chỉ định — `events` chỉ xem khi chọn riêng. */
const DEFAULT_TYPES: readonly LogType[] = ['request', 'audit', 'usage']

/**
 * Read log entries newest-first (feature UI). Write path và đường đọc theo driver
 * sống ở `src/backend/log` (`queryLogs`). Missing store → []. Malformed entries are
 * skipped. `limit` defaults to 200. Disabled types (settings) → skipped / empty.
 */
export function readLogs(opts: ReadLogsOpts = {}): Promise<LogEntry[]> {
  return queryLogs({
    type: opts.type ? opts.type : DEFAULT_TYPES,
    project: opts.project ?? null,
    limit: opts.limit ?? DEFAULT_LIMIT,
  })
}
