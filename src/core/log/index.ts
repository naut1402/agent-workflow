export {
  LOG_TYPES,
  LOG_LEVELS,
  AUDIT_OPS,
  AUDIT_ENTITIES,
  RequestLogEntry,
  AuditLogEntry,
  LogEntry,
  parseLogLine,
  levelFromHttpStatus,
  type LogType,
  type LogLevel,
  type AuditOp,
  type AuditEntity,
} from './schema.js'

export { getLogDriver, setLogDriver, resetLogDriver, type LogDriver } from './driver.js'
export { logsDir, logFile, appendFileLog } from './fileDriver.js'
export { appendLog, appendRequestLog, emitAudit } from './store.js'
export {
  getTraceId,
  runWithTraceId,
  runWithTraceIdAsync,
  resolveTraceIdFromRequest,
  newTraceId,
} from './traceContext.js'
