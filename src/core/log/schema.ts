import { z } from 'zod'

/**
 * Log entry schema (request/audit JSONL). Write path: `src/core/log` (driver + append).
 * Read UI: `src/features/logs/business`.
 *
 * Two kinds, discriminated by `type`:
 *  - `request` — one line per `/api/*` request (method/path/status/duration).
 *  - `audit`   — one line per config mutation (op/entity/identifier).
 *
 * Parsing is intentionally defensive: a malformed JSONL line yields `null` and
 * is skipped rather than throwing, mirroring the codebase's defensive-reads rule.
 *
 * `level` + `traceId` default when missing so older JSONL rows still parse.
 */
export const LOG_TYPES = ['request', 'audit'] as const
export type LogType = (typeof LOG_TYPES)[number]

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

export const AUDIT_OPS = ['create', 'update', 'delete', 'export'] as const
export type AuditOp = (typeof AUDIT_OPS)[number]

export const AUDIT_ENTITIES = [
  'pipeline',
  'custom-agent',
  'agent-template',
  'workflow-step-template',
  'pipeline-profile',
  'flow-profile',
  'project',
  'autoscan',
  'github-tokens',
  'logging',
  'runner',
  'connection',
  'credential',
  'command',
  'artifact',
  'artifact-actions',
  'task-state',
  'nl-chat-session',
] as const
export type AuditEntity = (typeof AUDIT_ENTITIES)[number]

const levelField = z.enum(LOG_LEVELS).default('info')
const traceIdField = z.string().default('')

export const RequestLogEntry = z.object({
  type: z.literal('request'),
  ts: z.number(),
  iso: z.string(),
  level: levelField,
  traceId: traceIdField,
  method: z.string(),
  path: z.string(),
  projectId: z.string().nullable(),
  status: z.number(),
  durationMs: z.number(),
  error: z.string().nullable().default(null),
})

export const AuditLogEntry = z.object({
  type: z.literal('audit'),
  ts: z.number(),
  iso: z.string(),
  level: levelField,
  traceId: traceIdField,
  op: z.enum(AUDIT_OPS),
  entity: z.enum(AUDIT_ENTITIES),
  identifier: z.string().nullable(),
  projectId: z.string().nullable(),
  detail: z.record(z.unknown()).optional(),
})

export const LogEntry = z.discriminatedUnion('type', [RequestLogEntry, AuditLogEntry])
export type LogEntry = z.infer<typeof LogEntry>
export type RequestLogEntry = z.infer<typeof RequestLogEntry>
export type AuditLogEntry = z.infer<typeof AuditLogEntry>

/** Map HTTP status → severity for request rows. */
export function levelFromHttpStatus(status: number): LogLevel {
  if (status >= 500) return 'error'
  if (status >= 400) return 'warn'
  return 'info'
}

/** Parse one JSONL line into a LogEntry, returning null on blank/garbage/invalid. */
export function parseLogLine(line: string): LogEntry | null {
  if (!line || !line.trim()) return null
  try {
    const parsed = LogEntry.safeParse(JSON.parse(line))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
