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
} from '../../shared/log/schema.js'

// Chỉ hợp đồng + get/set — hiện thực driver (file, sqlite) không lộ qua barrel; chỗ chọn là `driverInit.ts`.
export type { LogDriver, LogQuery } from './driver.js'
export { getLogDriver, setLogDriver, resetLogDriver, initLogDriverFromPrefs } from './driverInit.js'
export {
  LOG_DRIVER_KINDS,
  type LogDriverKind,
} from '../../shared/log/loggingPrefs.js'
export { getLogDriverPref, isLogTypeEnabled } from './loggingPrefsIo.js'
export { appendLog, appendRequestLog, appendUsageLog, emitAudit, queryLogs, logRevision } from './store.js'
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
