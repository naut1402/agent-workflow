import { AbstractBusiness } from '../../../core/business/AbstractBusiness.js'
import { readLogs } from './store.js'
import { readJobLog, readJobLogDelta, readTaskJobLogDelta } from './jobLog.js'
import { isLogTypeEnabled } from '../../../core/log/loggingPrefs.js'
import type { LogType } from '../../../core/log/schema.js'

export class LogsBusiness extends AbstractBusiness {
  listLogs(opts: { type?: LogType; project?: string; limit?: number }) {
    if (opts.type && !isLogTypeEnabled(opts.type)) return Promise.resolve([])
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

/** Peers from runner (owned by runner feature). */
export { loadJob, listJobs } from '../../runner/business/jobQueue.js'
export type { JobRecord, JobStatus } from '../../runner/business/types.js'

export { readLogs }
export { emitAudit, appendRequestLog } from '../../../core/log/store.js'
export { readJobLog, readJobLogDelta, readTaskJobLogDelta, sanitiseJobId } from './jobLog.js'
