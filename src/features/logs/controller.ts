import { AbstractController } from '../../backend/http/AbstractController.js'
import { on } from '../../backend/events/index.js'
import { sseResponse } from '../../backend/http/sseHelper.js'
import * as logsBusiness from './business/index.js'
import type { LogType } from '../../shared/log/schema.js'

/** Event vòng đời job nào đẩy sớm snapshot log, thay vì đợi tick interval. */
const JOB_STREAM_EVENTS = new Set([
  'job.queued',
  'job.started',
  'job.finished',
  'job.failed',
  'job.cancelled',
  'job.awaiting_recovery',
  'job.retry_scheduled',
  'job.recovered',
])

export class LogsController extends AbstractController {
  private biz() {
    return new logsBusiness.LogsBusiness(this.root)
  }

  async listLogs() {
    const typeQ = this.c.req.query('type')
    const type =
      typeQ === 'request' || typeQ === 'audit' || typeQ === 'events' || typeQ === 'usage' ? (typeQ as LogType) : undefined
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

  /**
   * SSE thay REST poll. Log là file do tiến trình con ghi (không có event
   * nguồn cho "vừa ghi thêm dòng") — route tự tail bằng interval nội bộ, event
   * vòng đời job chỉ đẩy sớm hơn chứ không thay được cho interval.
   */
  streamJobLog() {
    const id = logsBusiness.sanitiseJobId(this.c.req.param('id'))
    if (!id) return this.badRequest('invalid job id')
    const biz = this.biz()

    return sseResponse((send) => {
      let offset = 0
      const pushDelta = async () => {
        const r = await biz.getJobLogDelta(id, { offset, waitMs: 0 })
        if (!r.ok) return
        offset = r.size
        send('log', {
          text: r.text,
          size: r.size,
          reset: r.reset,
          hasMore: r.hasMore,
          status: 'status' in r ? r.status : undefined,
          exitCode: 'exitCode' in r ? r.exitCode : null,
          eof: r.eof,
        })
      }
      const safePushDelta = () => {
        pushDelta().catch((err) => console.warn('[logs] streamJobLog pushDelta failed:', err))
      }
      safePushDelta()
      const tick = setInterval(safePushDelta, 2500)
      const offEvents = on('*', (event) => {
        if (JOB_STREAM_EVENTS.has(event.type)) safePushDelta()
      })
      return () => {
        clearInterval(tick)
        offEvents()
      }
    })
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
