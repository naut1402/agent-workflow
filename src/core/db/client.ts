import type { Database } from 'bun:sqlite'
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
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
 *
 * Bun-only modules (`bun:sqlite`, `drizzle-orm/bun-sqlite`) are imported
 * dynamically ON PURPOSE: `vite.config.ts` pulls this file into its module
 * graph via `src/api/apiServer.ts`, and `vite build` loads that config under
 * Node, which cannot resolve the `bun:` scheme. Static imports here break
 * `bun run build` for the whole repo. Keep them dynamic.
 */

export type Db = BunSQLiteDatabase<typeof schema>

let cached: { db: Db; sqlite: Database } | null = null
let opening: Promise<Db> | null = null

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
    opening = openDb().finally(() => {
      opening = null
    })
  }
  return opening
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
  opening = null
}
