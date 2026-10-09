import { readTextFile } from '../lib/fileHelper.js'
import { logFile } from '../log/fileDriver.js'
import { LOG_TYPES, parseLogLine, type LogType } from '../../shared/log/schema.js'
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
 * One-off migration: copy JSONL log files into `log_entries`; read-only against the sources.
 * Not idempotent — running twice inserts duplicate rows.
 */
export async function migrateLogsToSqlite(): Promise<LogMigrationResult[]> {
  const db = await getDb()
  const results: LogMigrationResult[] = []
  for (const type of LOG_TYPES) {
    let raw: string
    try {
      raw = await readTextFile(logFile(type))
    } catch {
      results.push({ type, sourceExists: false, migrated: 0, skipped: 0 })
      continue
    }
    const rows: (typeof logEntries.$inferInsert)[] = []
    let skipped = 0
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      const entry = parseLogLine(line)
      if (!entry) {
        skipped++
        continue
      }
      rows.push({
        type: entry.type,
        ts: entry.ts,
        level: entry.level,
        traceId: entry.traceId,
        projectId: entry.projectId ?? null,
        payload: JSON.stringify(entry),
      })
    }
    db.transaction((tx) => {
      for (const row of rows) tx.insert(logEntries).values(row).run()
    })
    results.push({ type, sourceExists: true, migrated: rows.length, skipped })
  }
  return results
}
