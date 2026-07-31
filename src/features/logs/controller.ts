import { AbstractController } from '../../core/http/AbstractController.js'
import { LogsBusiness } from './business/index.js'
import type { LogType } from '../../core/contracts/schemas/log.js'

export class LogsController extends AbstractController {
  private biz() {
    return new LogsBusiness(this.root)
  }

  async listLogs() {
    const typeQ = this.c.req.query('type')
    const type = typeQ === 'request' || typeQ === 'audit' ? (typeQ as LogType) : undefined
    const project = this.c.req.query('project') || undefined
    const rawLimit = Number(this.c.req.query('limit'))
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, rawLimit), 1000) : 200
    const entries = await this.biz().listLogs({ type, project, limit })
    return this.ok({ entries })
  }

  async getJobLog() {
    const id = this.c.req.param('id')
    const rawOffset = this.c.req.query('offset')
    const rawWait = this.c.req.query('wait')
    const biz = this.biz()

    if (rawOffset != null || rawWait != null) {
      const offset = rawOffset != null ? Number(rawOffset) : 0
      const wait = rawWait != null ? Number(rawWait) : 0
      const r = await biz.getJobLogDelta(id, {
        offset: Number.isFinite(offset) ? offset : 0,
        waitMs: Number.isFinite(wait) ? wait : 0,
      })
      if ('error' in r) return this.json(r.status, { error: r.error })
      return this.ok(r)
    }

    const r = await biz.getJobLog(id)
    if ('error' in r) return this.json(r.status, { error: r.error })
    return this.ok({ id, text: r.text, size: r.size, truncated: r.truncated })
  }

  async getTaskJobLog() {
    const taskId = this.c.req.param('taskId')
    if (/[^\w\-]/.test(taskId)) return this.badRequest('invalid task id')
    const rawOffset = this.c.req.query('offset')
    const rawWait = this.c.req.query('wait')
    const offset = rawOffset != null ? Number(rawOffset) : 0
    const wait = rawWait != null ? Number(rawWait) : 0
    const r = await this.biz().getTaskJobLogDelta(taskId, {
      offset: Number.isFinite(offset) ? offset : 0,
      waitMs: Number.isFinite(wait) ? wait : 0,
    })
    if ('error' in r) return this.json(r.status, { error: r.error })
    return this.ok(r)
  }
}
