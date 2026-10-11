import { and, desc, eq, inArray, max } from 'drizzle-orm'
import { getDb } from '../db/client.js'
import { logEntries } from '../db/schema.js'
import { parseLogLine, type LogEntry } from '../../shared/log/schema.js'
import { logQueryTypes, type LogDriver } from './driver.js'

/** SQLite-backed `LogDriver` — writes into / reads from the shared `log_entries` table via Drizzle. */
export const sqliteLogDriver: LogDriver = {
  async append(entry) {
    try {
      const db = await getDb()
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

  /**
   * `limit` áp trong SQL **trước** khi parse, nên payload hỏng làm kết quả ngắn hơn `limit`
   * (khác driver file — giữ nguyên hành vi).
   */
  async query(q) {
    const types = logQueryTypes(q)
    if (!types.length) return []
    const project = q.project ?? null
    try {
      const conditions = [inArray(logEntries.type, [...types])]
      if (project !== null) conditions.push(eq(logEntries.projectId, project))
      const db = await getDb()
      const base = db
        .select()
        .from(logEntries)
        .where(and(...conditions))
        .orderBy(desc(logEntries.ts))
        .$dynamic()
      const rows = (q.limit == null ? base : base.limit(q.limit)).all()
      const out: LogEntry[] = []
      for (const row of rows) {
        const entry = parseLogLine(row.payload)
        if (entry) out.push(entry)
      }
      return out
    } catch {
      return []
    }
  },

  /** Revision = `max(id)` của type — bảng chỉ append, nên id tăng mỗi lần ghi. */
  async revision(type) {
    try {
      const db = await getDb()
      const row = db
        .select({ maxId: max(logEntries.id) })
        .from(logEntries)
        .where(eq(logEntries.type, type))
        .get()
      return String(row?.maxId ?? 0)
    } catch {
      return null
    }
  },
}
