import { AbstractBusiness } from '../../../backend/business/AbstractBusiness.js'
import { readLogs } from './store.js'
import { readJobLog, readJobLogDelta, readTaskJobLogDelta } from './jobLog.js'
import { isLogTypeEnabled, type LogType } from '../../../backend/log/index.js'

export class LogsBusiness extends AbstractBusiness {
  listLogs(opts: { type?: LogType; project?: string; limit?: number }) {
    return readLogs(opts)
  }

  getJobLog(id: string) {
    if (!isLogTypeEnabled('jobs')) {
      return Promise.resolve({ ok: true as const, text: '', size: 0, truncated: false })
    }
    return readJobLog(id)
  }

  getJobLogDelta(id: string, opts: { offset: number; waitMs: number }) {
    if (!isLogTypeEnabled('jobs')) {
      return Promise.resolve({
        ok: true as const,
        text: '',
        from: opts.offset,
        size: 0,
        eof: true,
        reset: false,
        hasMore: false,
      })
    }
    return readJobLogDelta(id, opts)
  }

  getTaskJobLogDelta(taskId: string, opts: { offset: number; waitMs: number }) {
    if (!isLogTypeEnabled('jobs')) {
      return Promise.resolve({
        ok: true as const,
        text: '',
        from: opts.offset,
        size: 0,
        eof: true,
        reset: false,
        hasMore: false,
      })
    }
    return readTaskJobLogDelta(taskId, opts)
  }
}

/** Peers from runner (owned by runner feature) — qua barrel runner. */
export { loadJob, listJobs, type JobRecord, type JobStatus } from '../../runner/business/index.js'

export { readLogs }
export { readJobLog, readJobLogDelta, readTaskJobLogDelta, resolveTaskJobId, sanitiseJobId } from './jobLog.js'
