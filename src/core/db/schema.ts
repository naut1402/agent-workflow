import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * Drizzle schema — kept SQLite/Postgres-portable (no SQLite-only feature) so
 * a later switch to Postgres (docs/../design.md §3.3) only swaps the driver.
 *
 * `payload` holds the full JSON-serialised `LogEntry` (schema.ts in core/log) —
 * the indexed columns (`type`, `ts`, `project_id`) mirror exactly what
 * `readLogs()` filters/sorts on today; everything else stays in `payload` so
 * per-type fields never force a wide, mostly-NULL table.
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
