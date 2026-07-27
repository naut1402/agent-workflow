import type { Hono } from 'hono'
import type { HonoEnv } from '../types.js'
import { j } from '../respond.js'
import { readLogs } from '../../logging/store.js'
import { readJobLog, readJobLogDelta, readTaskJobLogDelta } from '../../logging/jobLog.js'
import type { LogType } from '../../../shared/schemas/log.js'

// Read surface for the logging feature — global (not per-project).
//   GET /api/logs                      request + audit log
//   GET /api/jobs/:id/log              job execution log (tail or delta)
//   GET /api/tasks/:taskId/job-log     task-level aggregate log stream
export function registerLogRoutes(app: Hono<HonoEnv>): void {
  app.get('/api/logs', async (c) => {
    const typeQ = c.req.query('type')
    const type = typeQ === 'request' || typeQ === 'audit' ? (typeQ as LogType) : undefined
    const project = c.req.query('project') || undefined
    const rawLimit = Number(c.req.query('limit'))
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, rawLimit), 1000) : 200
    const entries = await readLogs({ type, project, limit })
    return j(c, 200, { entries })
  })

  app.get('/api/jobs/:id/log', async (c) => {
    const id = c.req.param('id')
    const rawOffset = c.req.query('offset')
    const rawWait = c.req.query('wait')

    if (rawOffset != null || rawWait != null) {
      const offset = rawOffset != null ? Number(rawOffset) : 0
      const wait = rawWait != null ? Number(rawWait) : 0
      const r = await readJobLogDelta(id, {
        offset: Number.isFinite(offset) ? offset : 0,
        waitMs: Number.isFinite(wait) ? wait : 0,
      })
      if ('error' in r) return j(c, r.status, { error: r.error })
      return j(c, 200, r)
    }

    const r = await readJobLog(id)
    if ('error' in r) return j(c, r.status, { error: r.error })
    return j(c, 200, { id, text: r.text, size: r.size, truncated: r.truncated })
  })

  app.get('/api/tasks/:taskId/job-log', async (c) => {
    const taskId = c.req.param('taskId')
    if (/[^\w\-]/.test(taskId)) return j(c, 400, { error: 'invalid task id' })
    const rawOffset = c.req.query('offset')
    const rawWait = c.req.query('wait')
    const offset = rawOffset != null ? Number(rawOffset) : 0
    const wait = rawWait != null ? Number(rawWait) : 0
    const r = await readTaskJobLogDelta(taskId, {
      offset: Number.isFinite(offset) ? offset : 0,
      waitMs: Number.isFinite(wait) ? wait : 0,
    })
    if ('error' in r) return j(c, r.status, { error: r.error })
    return j(c, 200, r)
  })
}
