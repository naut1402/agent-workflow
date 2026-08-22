import { Database } from 'bun:sqlite'
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import fs from 'node:fs'
import path from 'node:path'
import { dirnameFromImportMeta, resolvePath } from '../lib/fileHelper.js'
import { registryHome } from '../registry.js'
import * as schema from './schema.js'

/**
 * Shared `dashboard.sqlite` connection — one file for every subsystem migrated
 * off file-based storage (design.md §3.3). WAL mode: many readers run
 * alongside the single writer without blocking (deployment is single-container,
 * so single-writer is not a real constraint here).
 */

export type Db = BunSQLiteDatabase<typeof schema>

let cached: { db: Db; sqlite: Database } | null = null

function dbFilePath(): string {
  return path.join(registryHome(), 'dashboard.sqlite')
}

function migrationsFolder(): string {
  return resolvePath(dirnameFromImportMeta(import.meta.url), 'migrations')
}

/** Open (or reuse) the cached connection; runs pending migrations (idempotent). */
export function getDb(): Db {
  if (cached) return cached.db
  fs.mkdirSync(path.dirname(dbFilePath()), { recursive: true })
  const sqlite = new Database(dbFilePath(), { create: true })
  sqlite.exec('PRAGMA journal_mode = WAL')
  sqlite.exec('PRAGMA foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: migrationsFolder() })
  cached = { db, sqlite }
  return db
}

/** Tests only — drop the cached connection (e.g. after switching DEV_TEAM_DASHBOARD_HOME). */
export function resetDbForTest(): void {
  if (cached) {
    try {
      cached.sqlite.close()
    } catch {
      /* ignore */
    }
  }
  cached = null
}
