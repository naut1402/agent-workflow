#!/usr/bin/env bun
// One-off migration: copy `~/.dev-team-dashboard/logs/*.jsonl` into `dashboard.sqlite`.
// Run manually: `bun run scripts/migrate-logs-to-sqlite.ts`.
// Safe to run before or after switching `logging.driver` to `sqlite` — it only
// reads the JSONL files (never deletes/rewrites them).
// NOT idempotent — running twice on the same source files creates duplicate
// rows (no unique constraint on log entries). Truncate `log_entries` first if
// you need to re-run.
import { migrateLogsToSqlite } from '../src/core/db/migrateLogs.js'

const results = await migrateLogsToSqlite()
let totalMigrated = 0
let totalSkipped = 0
for (const r of results) {
  totalMigrated += r.migrated
  totalSkipped += r.skipped
  console.log(
    `${r.type}: sourceExists=${r.sourceExists} migrated=${r.migrated} skipped=${r.skipped}`,
  )
}
console.log(`Total: migrated=${totalMigrated} skipped=${totalSkipped}`)
