export {
  LOG_TYPES,
  LOG_LEVELS,
  AUDIT_OPS,
  AUDIT_ENTITIES,
  RequestLogEntry,
  AuditLogEntry,
  EventLogEntry,
  UsageSnapshotSchema,
  UsageLogEntry,
  LogEntry,
  parseLogLine,
  levelFromHttpStatus,
  formatRequestQuery,
  formatResponsePreview,
  truncateForLog,
  type LogType,
  type LogLevel,
  type AuditOp,
  type AuditEntity,
  type UsageSnapshot,
} from './schema.js'

export { getLogDriver, setLogDriver, resetLogDriver, activeLogDriverKind, type LogDriver } from './driver.js'
export { logsDir, logFile, appendFileLog } from './fileDriver.js'
export { sqliteLogDriver } from './sqliteDriver.js'
export { initLogDriverFromPrefs } from './driverInit.js'
export {
  LOG_DRIVER_KINDS,
  type LogDriverKind,
} from './loggingPrefs.js'
export { getLogDriverPref } from './loggingPrefsIo.js'
export { appendLog, appendRequestLog, appendUsageLog, emitAudit } from './store.js'
export {
  installEventLogSubscriber,
  uninstallEventLogSubscriberForTest,
  appendEventLog,
  prepareEventPayload,
} from './eventLogSubscriber.js'
export {
  getTraceId,
  runWithTraceId,
  runWithTraceIdAsync,
  resolveTraceIdFromRequest,
  newTraceId,
} from './traceContext.js'
