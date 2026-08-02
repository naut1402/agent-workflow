import { AbstractBusiness } from '../../../core/business/AbstractBusiness.js'
import { readLogs } from './store.js'
import { readJobLog, readJobLogDelta, readTaskJobLogDelta } from './jobLog.js'
import type { LogType } from '../../../core/log/schema.js'

export class LogsBusiness extends AbstractBusiness {
  listLogs(opts: { type?: LogType; project?: string; limit?: number }) {
    return readLogs(opts)
  }

  getJobLog(id: string) {
    return readJobLog(id)
  }

  getJobLogDelta(id: string, opts: { offset: number; waitMs: number }) {
    return readJobLogDelta(id, opts)
  }

  getTaskJobLogDelta(taskId: string, opts: { offset: number; waitMs: number }) {
    return readTaskJobLogDelta(taskId, opts)
  }
}

/** Peers from runner (owned by runner feature). */
export { loadJob, listJobs } from '../../runner/business/jobQueue.js'
export type { JobRecord, JobStatus } from '../../runner/business/types.js'

export { readLogs }
export { emitAudit, appendRequestLog } from '../../../core/log/store.js'
export { readJobLog, readJobLogDelta, readTaskJobLogDelta, sanitiseJobId } from './jobLog.js'
