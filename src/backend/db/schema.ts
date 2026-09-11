import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * Drizzle schema — kept SQLite/Postgres-portable (no SQLite-only feature) so a
 * later switch to Postgres only swaps the driver.
 *
 * `payload` holds the full JSON-serialised `LogEntry` (schema.ts in core/log);
 * per-type fields stay in there so they never force a wide, mostly-NULL table.
 * `type`/`ts`/`project_id` are lifted out and indexed because `readLogs()`
 * filters and sorts on them; `level`/`trace_id` are spare columns for filters
 * that do not exist yet, so nothing reads them.
 */
export const logEntries = sqliteTable(
  'log_entries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    type: text('type').notNull(),
    ts: integer('ts').notNull(),
    level: text('level').notNull(),
    traceId: text('trace_id').notNull().default(''),
    projectId: text('project_id'),
    payload: text('payload').notNull(),
  },
  (table) => [
    index('idx_log_entries_type_ts').on(table.type, table.ts),
    index('idx_log_entries_project_ts').on(table.projectId, table.ts),
  ],
)
