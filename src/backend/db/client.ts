import type { Database } from 'bun:sqlite'
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { dirnameFromImportMeta, resolvePath } from '../lib/fileHelper.js'
import { registryHome } from '../registry.js'
import * as schema from './schema.js'

export type Db = BunSQLiteDatabase<typeof schema>

let cached: { db: Db; sqlite: Database } | null = null
let opening: Promise<Db> | null = null
let warnedUnavailable = false

function dbFilePath(): string {
  return path.join(registryHome(), 'dashboard.sqlite')
}

function migrationsFolder(): string {
  return resolvePath(dirnameFromImportMeta(import.meta.url), 'migrations')
}

// xem docs/agent-rules/coding-guideline.md §1
async function openDb(): Promise<Db> {
  const { Database: BunDatabase } = await import('bun:sqlite')
  const { drizzle } = await import('drizzle-orm/bun-sqlite')
  const { migrate } = await import('drizzle-orm/bun-sqlite/migrator')
  fs.mkdirSync(path.dirname(dbFilePath()), { recursive: true })
  const sqlite = new BunDatabase(dbFilePath(), { create: true })
  sqlite.exec('PRAGMA journal_mode = WAL')
  sqlite.exec('PRAGMA foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: migrationsFolder() })
  cached = { db, sqlite }
  return db
}

/** Open (or reuse) the cached connection; runs pending migrations (idempotent). */
export function getDb(): Promise<Db> {
  if (cached) return Promise.resolve(cached.db)
  if (!opening) {
    opening = openDb()
      .catch((err: unknown) => {
        // xem docs/architecture/README.md §4.4
        if (!warnedUnavailable) {
          warnedUnavailable = true
          console.error(
            '[db] sqlite unavailable — log entries are being dropped; knowledge collection/tag return 500:',
            err,
          )
        }
        throw err
      })
      .finally(() => {
        opening = null
      })
  }
  return opening
}

/**
 * Tests only — drop the cached connection (e.g. after switching DEV_TEAM_DASHBOARD_HOME).
 * Not safe while an `openDb()` is in flight: it resolves afterwards and re-caches the old path.
 */
export function resetDbForTest(): void {
  if (cached) {
    try {
      cached.sqlite.close()
    } catch {
      /* ignore */
    }
  }
  cached = null
  opening = null
  warnedUnavailable = false
}
