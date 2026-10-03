import { z } from 'zod'

/**
 * Log entry schema (request/audit JSONL). Write path: `src/backend/log` (driver + append).
 * Read UI: `src/features/logs/business`.
 *
 * Five kinds, discriminated by `type`:
 *  - `request`   — one line per `/api/*` request (method/path/status/duration).
 *  - `audit`     — one line per config mutation (op/entity/identifier).
 *  - `events`    — one line per domain event from the in-process bus (`event` field
 *                  holds DashboardEvent.type; do not confuse with this discriminant).
 *  - `usage`     — one line per job LLM token snapshot (`UsageSnapshot` + source).
 *  - `tool-call` — one line per JOB (not per call) listing the tool calls that job
 *                  made. Opt-in; feeds `scripts/tool-usage-stats.ts`.
 *
 * Parsing is intentionally defensive: a malformed JSONL line yields `null` and
 * is skipped rather than throwing, mirroring the codebase's defensive-reads rule.
 *
 * `level` + `traceId` default when missing so older JSONL rows still parse.
 */
export const LOG_TYPES = ['request', 'audit', 'events', 'usage', 'tool-call'] as const
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
  'modes',
  'scan-patterns',
  'security',
  'recovery',
  'runner',
  'connection',
  'provider-config',
  'credential',
  'command',
  'mcp-server',
  'artifact',
  'artifact-actions',
  'task-state',
  'worktree',
  'nl-chat-session',
  'nl-chat-attachment',
  'automation',
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
  /** Raw query string without leading `?` (truncated when long). */
  query: z.string().default(''),
  /** Response body preview (truncated; binary → placeholder). */
  response: z.string().default(''),
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

export const EventLogEntry = z.object({
  type: z.literal('events'),
  ts: z.number(),
  iso: z.string(),
  level: levelField,
  traceId: traceIdField,
  /** Domain event name (`job.started`, `entity.created`, …). */
  event: z.string(),
  payload: z.record(z.unknown()).default({}),
  projectId: z.string().nullable(),
})


/** Long-lived token/cost boundary schema (P0: estimatedCostUsd always null). */
export const UsageSnapshotSchema = z.object({
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  cacheReadTokens: z.number().nonnegative().optional(),
  cacheWriteTokens: z.number().nonnegative().optional(),
  totalTokens: z.number().nonnegative(),
  estimatedCostUsd: z.number().nullable(),
  model: z.string().nullable(),
  provider: z.string(),
  taskId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  stepId: z.string().nullable().optional(),
  phase: z.string().nullable().optional(),
  pipelineId: z.string().nullable().optional(),
  jobId: z.string(),
  sessionId: z.string().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  finishedAt: z.string().nullable().optional(),
  durationMs: z.number().nullable().optional(),
})
export type UsageSnapshot = z.infer<typeof UsageSnapshotSchema>

export const UsageLogEntry = z.object({
  type: z.literal('usage'),
  ts: z.number(),
  iso: z.string(),
  level: levelField,
  traceId: traceIdField,
  ...UsageSnapshotSchema.shape,
  source: z.enum(['main', 'subagent', 'aggregate', 'stdout']).optional(),
  agentType: z.string().nullable().optional(),
})

/**
 * One tool invocation inside a job. `text` is the command / primary argument —
 * redacted and capped by the writer, but newlines are KEPT: intent analysis needs
 * the whole `&&` chain and the heredoc body, unlike `describeToolUse()` in
 * `sessionTranscript.ts` which deliberately keeps only the first line.
 */
export const ToolCallSchema = z.object({
  /** `Bash` | `Read` | `mcp__agent-workflow__list_tasks` | `search_files` | … */
  name: z.string(),
  /** ISO timestamp of the block; `null` for sources that keep no per-call time. */
  at: z.string().nullable().default(null),
  text: z.string().default(''),
  /** `true` = the call came from a subagent (`isSidechain`). */
  sidechain: z.boolean().default(false),
})
export type ToolCall = z.infer<typeof ToolCallSchema>

/**
 * One entry per JOB, not per call. Per-call rows would push ~30k lines through the
 * 5 MB file-driver rotation (which keeps a single `.1` backup) and lose exactly the
 * history this log exists to keep — the problem transcript pruning already caused.
 */
export const ToolCallLogEntry = z.object({
  type: z.literal('tool-call'),
  ts: z.number(),
  iso: z.string(),
  level: levelField,
  traceId: traceIdField,
  jobId: z.string(),
  sessionId: z.string().nullable().default(null),
  taskId: z.string().nullable().default(null),
  projectId: z.string().nullable().default(null),
  stepId: z.string().nullable().default(null),
  agentRef: z.string().nullable().default(null),
  /** `connection.providerId` of the job that produced these calls. */
  provider: z.string().default(''),
  source: z.enum(['cli-transcript', 'agent-sdk-session']).default('cli-transcript'),
  /**
   * Calls seen BEFORE the `TOOL_CALL_MAX_CALLS` cap, so `callsTotal > calls.length`
   * means exactly one thing — "this entry was truncated" — which is what
   * `coverage.truncatedEntries` reports. Agent-SDK dedupe happens BEFORE this count:
   * resume rewrites the whole session file, so those repeats are an artefact of the
   * storage format, not calls that were dropped.
   */
  callsTotal: z.number(),
  calls: z.array(ToolCallSchema),
})

export const LogEntry = z.discriminatedUnion('type', [
  RequestLogEntry,
  AuditLogEntry,
  EventLogEntry,
  UsageLogEntry,
  ToolCallLogEntry,
])
export type LogEntry = z.infer<typeof LogEntry>
export type RequestLogEntry = z.infer<typeof RequestLogEntry>
export type AuditLogEntry = z.infer<typeof AuditLogEntry>
export type EventLogEntry = z.infer<typeof EventLogEntry>
export type UsageLogEntry = z.infer<typeof UsageLogEntry>
export type ToolCallLogEntry = z.infer<typeof ToolCallLogEntry>

/** Cap stored query/response previews so JSONL stays bounded. */
export const LOG_QUERY_MAX_CHARS = 2_048
export const LOG_RESPONSE_MAX_CHARS = 4_096

/**
 * Caps for one `tool-call` entry. The heaviest session measured was 63 calls, so
 * `TOOL_CALL_MAX_CALLS` is headroom rather than a real limit — but when it does
 * bite, `callsTotal` keeps the true number so the report says "truncated" instead
 * of silently under-counting.
 */
export const TOOL_CALL_MAX_CALLS = 500
/** Per-call `text` cap, in characters (ellipsis included). */
export const TOOL_CALL_TEXT_MAX_CHARS = 2_048
/** Total `text` budget per entry; calls past it keep `name` + `at` and drop `text`. */
export const TOOL_CALL_TEXT_BUDGET = 65_536

/**
 * Keys that must never land in log previews.
 *
 * Exported so the tool-call redactor reuses THIS regex: two drifting sets of
 * redaction rules is guaranteed debt (see `redactToolText` in
 * `src/features/runner/business/toolCallCapture.ts`).
 */
export const SENSITIVE_KEY_RE = /(token|pat|secret|password|api[-_]?key|authorization)/i

export function truncateForLog(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}

function redactQueryParams(raw: string): string {
  try {
    const sp = new URLSearchParams(raw)
    let changed = false
    for (const k of [...sp.keys()]) {
      if (SENSITIVE_KEY_RE.test(k)) {
        sp.set(k, '[redacted]')
        changed = true
      }
    }
    return changed ? sp.toString() : raw
  } catch {
    return raw
  }
}

function redactSensitiveValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveValue)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY_RE.test(k) ? '[redacted]' : redactSensitiveValue(v)
    }
    return out
  }
  return value
}

function redactResponseText(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return text
  try {
    return JSON.stringify(redactSensitiveValue(JSON.parse(trimmed)))
  } catch {
    return text
  }
}

/** Query string without leading `?`, redacted + truncated. */
export function formatRequestQuery(search: string): string {
  const raw = search.startsWith('?') ? search.slice(1) : search
  return truncateForLog(redactQueryParams(raw), LOG_QUERY_MAX_CHARS)
}

/** UTF-8 text preview from response bytes + content-type (slice before decode). */
export function formatResponsePreview(buf: Buffer, contentType: string | null | undefined): string {
  const ct = (contentType || '').toLowerCase()
  const textual =
    !ct ||
    ct.includes('json') ||
    ct.includes('text/') ||
    ct.includes('xml') ||
    ct.includes('javascript') ||
    ct.includes('urlencoded')
  if (!textual) {
    return truncateForLog(`[binary ${ct || 'unknown'} ${buf.length}b]`, LOG_RESPONSE_MAX_CHARS)
  }
  // Max UTF-8 char is 4 bytes — enough prefix for LOG_RESPONSE_MAX_CHARS without decoding whole body.
  const slice = buf.subarray(0, LOG_RESPONSE_MAX_CHARS * 4)
  return truncateForLog(redactResponseText(slice.toString('utf8')), LOG_RESPONSE_MAX_CHARS)
}

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
