import { readTextFile } from '../lib/fileHelper.js'
import { logFile } from '../log/fileDriver.js'
import { LOG_TYPES, parseLogLine, type LogType } from '../log/schema.js'
import { getDb } from './client.js'
import { logEntries } from './schema.js'

export type LogMigrationResult = {
  type: LogType
  /** Source JSONL file existed and was read. */
  sourceExists: boolean
  migrated: number
  /** Lines that failed to parse (malformed JSON / schema mismatch) — not migrated. */
  skipped: number
}

/**
 * One-off migration: copy existing JSONL log files into `log_entries`.
 * Read-only against the source files (never deletes/rewrites them — they stay
 * as a backup, design.md §4.3). Not run automatically; invoked manually via
 * `scripts/migrate-logs-to-sqlite.ts`.
 *
 * Not idempotent: running twice inserts duplicate rows (no unique constraint —
 * `ts` can collide across entries). Truncate `log_entries` before re-running
 * if a clean re-migration is needed.
 */
export async function migrateLogsToSqlite(): Promise<LogMigrationResult[]> {
  const db = getDb()
  const results: LogMigrationResult[] = []
  for (const type of LOG_TYPES) {
    let raw: string
    try {
      raw = await readTextFile(logFile(type))
    } catch {
      results.push({ type, sourceExists: false, migrated: 0, skipped: 0 })
      continue
    }
    let migrated = 0
    let skipped = 0
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      const entry = parseLogLine(line)
      if (!entry) {
        skipped++
        continue
      }
      db.insert(logEntries)
        .values({
          type: entry.type,
          ts: entry.ts,
          level: entry.level,
          traceId: entry.traceId,
          projectId: entry.projectId ?? null,
          payload: JSON.stringify(entry),
        })
        .run()
      migrated++
    }
    results.push({ type, sourceExists: true, migrated, skipped })
  }
  return results
}
