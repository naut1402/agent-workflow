#!/usr/bin/env bun
import { migrateLogsToSqlite } from '../src/backend/db/migrateLogs.js'

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
