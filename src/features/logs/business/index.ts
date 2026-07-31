import { AbstractBusiness } from '../../../core/business/AbstractBusiness.js'
import { readLogs, emitAudit, appendRequestLog } from './store.js'
import { readJobLog, readJobLogDelta, readTaskJobLogDelta } from './jobLog.js'
import type { LogType } from '../../../core/contracts/schemas/log.js'

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

export { readLogs, emitAudit, appendRequestLog, readJobLog, readJobLogDelta, readTaskJobLogDelta }
