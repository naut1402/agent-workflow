import fs from 'node:fs/promises'
import path from 'node:path'
import { registryHome } from '../registry.js'
import { statSafe } from '../../core/contracts/fs.js'
import {
  type LogEntry,
  type LogType,
  type AuditOp,
  type AuditEntity,
  parseLogLine,
} from '../../core/contracts/schemas/log.js'

// Append-only JSONL log store, global under `~/.dev-team-dashboard/logs/`.
// Depends only on shared/ + the registry home resolver — knows nothing of HTTP.
//
// Writes are fire-and-forget and swallow every error: a logging failure must
// never break the request that triggered it (defensive-reads invariant).

const MAX_BYTES = 5 * 1024 * 1024 // 5MB per file; one .1 backup is kept on rotation.

function logsDir(): string {
  return path.join(registryHome(), 'logs')
}

function logFile(type: LogType): string {
  return path.join(logsDir(), `${type}.jsonl`)
}

/** Rotate a log file once it exceeds MAX_BYTES: rename to `<file>.1` (single backup). */
async function rotateIfNeeded(file: string): Promise<void> {
  const info = await statSafe(file)
  if (info.exists && info.size > MAX_BYTES) {
    try {
      await fs.rename(file, `${file}.1`)
    } catch {
      /* ignore — keep appending to the existing file rather than lose the write */
    }
  }
}

/** Append one entry as a single JSONL line. Never throws. */
export async function appendLog(entry: LogEntry): Promise<void> {
  try {
    const dir = logsDir()
    await fs.mkdir(dir, { recursive: true })
    const file = logFile(entry.type)
    await rotateIfNeeded(file)
    await fs.appendFile(file, JSON.stringify(entry) + '\n', 'utf8')
  } catch {
    /* swallow — logging must never break the caller */
  }
}

function now(): { ts: number; iso: string } {
  const d = new Date()
  return { ts: d.getTime(), iso: d.toISOString() }
}

/** Record one `/api/*` request. Fire-and-forget. */
export function appendRequestLog(p: {
  method: string
  path: string
  projectId: string | null
  status: number
  durationMs: number
  error?: string | null
}): void {
  void appendLog({ type: 'request', ...now(), ...p, error: p.error ?? null }).catch(() => {})
}

/** Record one config mutation. Fire-and-forget; call only on the success path. */
export function emitAudit(p: {
  op: AuditOp
  entity: AuditEntity
  identifier: string | null
  projectId: string | null
  detail?: Record<string, unknown>
}): void {
  void appendLog({ type: 'audit', ...now(), ...p }).catch(() => {})
}

/**
 * Read log entries newest-first, optionally filtered by type and project.
 * Missing file → []. Malformed lines are skipped. `limit` defaults to 200.
 */
export async function readLogs(opts: {
  type?: LogType
  project?: string | null
  limit?: number
} = {}): Promise<LogEntry[]> {
  const types: LogType[] = opts.type ? [opts.type] : ['request', 'audit']
  const out: LogEntry[] = []
  for (const t of types) {
    let raw: string
    try {
      raw = await fs.readFile(logFile(t), 'utf8')
    } catch {
      continue
    }
    for (const line of raw.split('\n')) {
      const entry = parseLogLine(line)
      if (!entry) continue
      if (opts.project !== undefined && opts.project !== null && entry.projectId !== opts.project) continue
      out.push(entry)
    }
  }
  out.sort((a, b) => b.ts - a.ts)
  return out.slice(0, opts.limit ?? 200)
}
