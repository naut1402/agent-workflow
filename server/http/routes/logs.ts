import type { Hono } from 'hono'
import type { HonoEnv } from '../types.js'
import { j } from '../respond.js'
import { readLogs } from '../../logging/store.js'
import { readJobLog } from '../../logging/jobLog.js'
import type { LogType } from '../../../shared/schemas/log.js'

// Read surface for the logging feature — global (not per-project).
//   GET /api/logs            request + audit log, filter by type/project/limit
//   GET /api/jobs/:id/log     job execution log tail (traversal-guarded id)
export function registerLogRoutes(app: Hono<HonoEnv>): void {
  app.get('/api/logs', async (c) => {
    const typeQ = c.req.query('type')
    const type = typeQ === 'request' || typeQ === 'audit' ? (typeQ as LogType) : undefined
    const project = c.req.query('project') || undefined
    const limit = Number(c.req.query('limit')) || 200
    const entries = await readLogs({ type, project, limit })
    return j(c, 200, { entries })
  })

  app.get('/api/jobs/:id/log', async (c) => {
    const id = c.req.param('id')
    const r = await readJobLog(id)
    if ('error' in r) return j(c, r.status, { error: r.error })
    return j(c, 200, { id, text: r.text, size: r.size, truncated: r.truncated })
  })
}
