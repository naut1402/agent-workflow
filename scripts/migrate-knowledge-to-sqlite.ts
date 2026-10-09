#!/usr/bin/env bun
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
