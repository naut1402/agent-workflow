import { getDb } from '../db/client.js'
import { logEntries } from '../db/schema.js'
import type { LogDriver } from './driver.js'

/** SQLite-backed `LogDriver` — writes into the shared `log_entries` table via Drizzle. */
export const sqliteLogDriver: LogDriver = {
  kind: 'sqlite',
  async append(entry) {
    try {
      const db = getDb()
      db.insert(logEntries)
        .values({
          type: entry.type,
          ts: entry.ts,
          level: entry.level,
          traceId: entry.traceId,
          projectId: entry.projectId ?? null,
          payload: JSON.stringify(entry),
        })
        .run()
    } catch {
      /* swallow — append must never throw (AGENTS.md §4) */
    }
  },
}
