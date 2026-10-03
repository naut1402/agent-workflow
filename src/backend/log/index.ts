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
  ToolCallSchema,
  ToolCallLogEntry,
  LogEntry,
  parseLogLine,
  levelFromHttpStatus,
  formatRequestQuery,
  formatResponsePreview,
  truncateForLog,
  SENSITIVE_KEY_RE,
  TOOL_CALL_MAX_CALLS,
  TOOL_CALL_TEXT_MAX_CHARS,
  TOOL_CALL_TEXT_BUDGET,
  type LogType,
  type LogLevel,
  type AuditOp,
  type AuditEntity,
  type UsageSnapshot,
  type ToolCall,
} from '../../shared/log/schema.js'

export { getLogDriver, setLogDriver, resetLogDriver, activeLogDriverKind, type LogDriver } from './driver.js'
export { logsDir, logFile, appendFileLog } from './fileDriver.js'
export { sqliteLogDriver } from './sqliteDriver.js'
export { initLogDriverFromPrefs } from './driverInit.js'
export {
  LOG_DRIVER_KINDS,
  type LogDriverKind,
} from '../../shared/log/loggingPrefs.js'
export { getLogDriverPref } from './loggingPrefsIo.js'
export { appendLog, appendRequestLog, appendUsageLog, appendToolCallLog, emitAudit } from './store.js'
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
