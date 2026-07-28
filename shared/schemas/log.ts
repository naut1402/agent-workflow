import { z } from 'zod'

/**
 * Log entries persisted as append-only JSONL under `~/.dev-team-dashboard/logs/`.
 * Zod is the single source of truth — UI/server types come from `z.infer`.
 *
 * Two kinds, discriminated by `type`:
 *  - `request` — one line per `/api/*` request (method/path/status/duration).
 *  - `audit`   — one line per config mutation (op/entity/identifier).
 *
 * Parsing is intentionally defensive: a malformed JSONL line yields `null` and
 * is skipped rather than throwing, mirroring the codebase's defensive-reads rule.
 */
export const LOG_TYPES = ['request', 'audit'] as const
export type LogType = (typeof LOG_TYPES)[number]

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
  'runner',
  'connection',
  'credential',
  'artifact',
  'artifact-actions',
  'task-state',
] as const
export type AuditEntity = (typeof AUDIT_ENTITIES)[number]

export const RequestLogEntry = z.object({
  type: z.literal('request'),
  ts: z.number(),
  iso: z.string(),
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
