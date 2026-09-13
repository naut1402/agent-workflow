#!/usr/bin/env bun
// One-off migration: copy `collections.yaml` (collection + tag alias) of every
// registered project and of the global store into `dashboard.sqlite`.
// Run manually: `bun run scripts/migrate-knowledge-to-sqlite.ts`.
// Only reads the YAML files — they stay on disk as a backup.
// Idempotent: re-running inserts nothing (UNIQUE(store_key, collection_id)).
import { migrateKnowledgeToSqlite } from '../src/backend/db/migrateKnowledge.js'

const results = await migrateKnowledgeToSqlite()
let totalCollections = 0
let totalAliases = 0
let totalSkipped = 0
for (const r of results) {
  totalCollections += r.collections
  totalAliases += r.aliases
  totalSkipped += r.skipped
  console.log(
    `${r.storeKey}: sourceExists=${r.sourceExists} collections=${r.collections} aliases=${r.aliases} skipped=${r.skipped}`,
  )
}
console.log(
  `Total: collections=${totalCollections} aliases=${totalAliases} skipped=${totalSkipped}`,
)
