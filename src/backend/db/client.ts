import type { Database } from 'bun:sqlite'
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { dirnameFromImportMeta, resolvePath } from '../lib/fileHelper.js'
import { registryHome } from '../registry.js'
import * as schema from './schema.js'

/**
 * Shared `dashboard.sqlite` connection — one file for every subsystem that moves
 * off file-based storage. WAL lets readers run alongside the single writer.
 *
 * Bun-only modules are imported dynamically because `vite build` loads
 * `vite.config.ts` under Node, which cannot resolve the `bun:` scheme — static
 * imports here break `bun run build` (`docs/architecture.md` §6).
 */

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
        // Callers swallow failures to stay non-throwing, so without this an unusable backend reads exactly like "no logs yet".
        if (!warnedUnavailable) {
          warnedUnavailable = true
          console.error('[log] sqlite backend unavailable — log entries are being dropped:', err)
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
