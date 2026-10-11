import os from 'node:os'
import {
  joinPath,
  readTextFile,
  resolvePath,
  resolvePathUnder,
  safeReadDir,
} from '../../../backend/lib/fileHelper.js'
import { isLogTypeEnabled } from '../../../backend/log/loggingPrefsIo.js'
import { getUsageCursor, setUsageCursor, type UsageCursor } from './sessionLedger.js'
import { recordJobUsage } from './usageCapture.js'
import type { JobRecord } from './types.js'

/**
 * Claude Code CLI transcript reader — parse `~/.claude/projects/…` JSONL for
 * token usage. Defensive I/O: missing/corrupt files → null / skip, never throw.
 */

const SESSION_ID_RE = /^[0-9a-fA-F-]+$/

export type ClaudeTokenUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export type ClaudeUsageReadResult = {
  usage: ClaudeTokenUsage
  model: string | null
  totalLines: number
}

export function encodeCwdForClaudeProjects(cwd: string): string {
  return resolvePath(cwd).replace(/[/.]/g, '-')
}

export function claudeProjectsRoot(): string {
  return joinPath(os.homedir(), '.claude', 'projects')
}

export function isValidClaudeSessionId(sessionId: string): boolean {
  return typeof sessionId === 'string' && SESSION_ID_RE.test(sessionId) && sessionId.length > 0
}

/** Main session transcript path, or null if path escapes `~/.claude/projects`. */
export function sessionTranscriptPath(cwd: string, sessionId: string): string | null {
  if (!isValidClaudeSessionId(sessionId)) return null
  const encoded = encodeCwdForClaudeProjects(cwd)
  return resolvePathUnder(claudeProjectsRoot(), encoded, `${sessionId}.jsonl`)
}

/** Subagents directory for a session, or null if unsafe. */
export function subagentsDir(cwd: string, sessionId: string): string | null {
  if (!isValidClaudeSessionId(sessionId)) return null
  const encoded = encodeCwdForClaudeProjects(cwd)
  return resolvePathUnder(claudeProjectsRoot(), encoded, sessionId, 'subagents')
}

function emptyUsage(): ClaudeTokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
}

function numField(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0
}

function parseUsageObject(raw: unknown): ClaudeTokenUsage | null {
  if (!raw || typeof raw !== 'object') return null
  const u = raw as Record<string, unknown>
  return {
    inputTokens: numField(u.input_tokens),
    outputTokens: numField(u.output_tokens),
    cacheReadTokens: numField(u.cache_read_input_tokens),
    cacheWriteTokens: numField(u.cache_creation_input_tokens),
  }
}

function hasAnyTokens(u: ClaudeTokenUsage): boolean {
  return u.inputTokens > 0 || u.outputTokens > 0 || u.cacheReadTokens > 0 || u.cacheWriteTokens > 0
}

/**
 * Read transcript from `fromLine` (0-based) to EOF. Dedupes by `message.id`
 * within the new slice so multi-block assistant rows do not double-count.
 */
export async function readNewUsage(
  filePath: string,
  fromLine: number,
): Promise<ClaudeUsageReadResult | null> {
  let raw: string
  try {
    raw = await readTextFile(filePath)
  } catch {
    return null
  }

  const lines = raw.split('\n')
  // Trailing newline → last empty segment; keep totalLines as physical line count
  // excluding a final empty segment only when file ends with `\n`.
  const totalLines = raw.endsWith('\n') ? Math.max(0, lines.length - 1) : lines.length
  const start = Math.max(0, Math.floor(fromLine))
  const seen = new Map<string, ClaudeTokenUsage>()
  let model: string | null = null

  for (let i = start; i < totalLines; i++) {
    const line = lines[i]
    if (!line || !line.trim()) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object') continue
    const row = parsed as Record<string, unknown>
    if (row.type !== 'assistant') continue
    const message = row.message
    if (!message || typeof message !== 'object') continue
    const msg = message as Record<string, unknown>
    const usage = parseUsageObject(msg.usage)
    if (!usage || !hasAnyTokens(usage)) continue
    const id = typeof msg.id === 'string' && msg.id ? msg.id : `__line_${i}`
    if (!seen.has(id)) seen.set(id, usage)
    if (typeof msg.model === 'string' && msg.model) model = msg.model
  }

  const usage = emptyUsage()
  for (const u of seen.values()) {
    usage.inputTokens += u.inputTokens
    usage.outputTokens += u.outputTokens
    usage.cacheReadTokens += u.cacheReadTokens
    usage.cacheWriteTokens += u.cacheWriteTokens
  }

  return { usage, model, totalLines }
}

/** List `agent-*.jsonl` basenames in dir that are not already processed. */
export async function listNewSubagentFiles(
  dir: string,
  alreadyProcessed: string[],
): Promise<string[]> {
  const known = new Set(alreadyProcessed)
  const entries = await safeReadDir(dir)
  const out: string[] = []
  for (const ent of entries) {
    if (!ent.isFile()) continue
    const name = ent.name
    if (!name.startsWith('agent-') || !name.endsWith('.jsonl')) continue
    if (known.has(name)) continue
    // Also accept full path in alreadyProcessed for older cursors.
    if (known.has(joinPath(dir, name))) continue
    out.push(name)
  }
  out.sort()
  return out
}

/** Absolute path for a subagent basename under dir (null if escapes). */
export function resolveSubagentFile(dir: string, basenameFile: string): string | null {
  if (!basenameFile || basenameFile.includes('/') || basenameFile.includes('\\') || basenameFile.includes('..')) {
    return null
  }
  return resolvePathUnder(dir, basenameFile)
}

export async function readSubagentUsage(filePath: string): Promise<ClaudeUsageReadResult | null> {
  return readNewUsage(filePath, 0)
}

export function sumTokenUsage(parts: ClaudeTokenUsage[]): ClaudeTokenUsage {
  const usage = emptyUsage()
  for (const u of parts) {
    usage.inputTokens += u.inputTokens
    usage.outputTokens += u.outputTokens
    usage.cacheReadTokens += u.cacheReadTokens
    usage.cacheWriteTokens += u.cacheWriteTokens
  }
  return usage
}

export function totalTokensOf(u: ClaudeTokenUsage): number {
  return u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens
}

export { hasAnyTokens }

type UsagePart = {
  source: 'main' | 'subagent'
  usage: ClaudeTokenUsage
  model: string | null
}

function metaString(job: JobRecord, key: string): string | null {
  const v = job.metadata?.[key]
  return typeof v === 'string' && v ? v : null
}

/** Phiên đã gắn vào task (có `projectId` + `taskId`) mới có cursor trên task ledger. */
type TaskSessionKey = { projectId: string; taskId: string; sessionId: string }

function taskSessionKey(job: JobRecord, sessionId: string): TaskSessionKey | null {
  const projectId = metaString(job, 'projectId')
  const taskId = metaString(job, 'taskId')
  return projectId && taskId ? { projectId, taskId, sessionId } : null
}

function readCursor(key: TaskSessionKey | null): UsageCursor {
  const empty = { mainLines: 0, subagentFiles: [] }
  if (!key) return empty
  return getUsageCursor(key.projectId, key.taskId, key.sessionId) ?? empty
}

function writeCursor(key: TaskSessionKey | null, cursor: UsageCursor): void {
  if (key) setUsageCursor(key.projectId, key.taskId, key.sessionId, cursor)
}

/** Usage của các file subagent MỚI (chưa có trong cursor) — trả cả danh sách file đã đi qua để tiến cursor. */
async function readNewSubagentParts(
  workspace: string,
  sessionId: string,
  knownFiles: string[],
): Promise<{ parts: UsagePart[]; newFiles: string[] }> {
  const parts: UsagePart[] = []
  const newFiles: string[] = []
  const subDir = subagentsDir(workspace, sessionId)
  if (!subDir) return { parts, newFiles }
  const names = await listNewSubagentFiles(subDir, knownFiles)
  for (const name of names) {
    newFiles.push(name)
    const abs = resolveSubagentFile(subDir, name)
    if (!abs) continue
    const sub = await readSubagentUsage(abs)
    if (sub && hasAnyTokens(sub.usage)) {
      parts.push({ source: 'subagent', usage: sub.usage, model: sub.model })
    }
  }
  return { parts, newFiles }
}

/** Model của phần cuối cùng có khai model. */
function lastModelOf(parts: UsagePart[]): string | null {
  let model: string | null = null
  for (const p of parts) {
    if (p.model) model = p.model
  }
  return model
}

/**
 * Capture Claude transcript token delta for a finished job — hook
 * `captureUsage` của `ClaudeCliProvider`, ghi `source: 'aggregate'`.
 * Prefs `logging.types.usage === false` skips JobRecord + JSONL (least surprise).
 * Never throws to callers — jobQueue invokes fire-and-forget.
 */
export async function captureClaudeTranscriptUsage(
  job: JobRecord,
  sessionId: string,
  providerId: string,
): Promise<void> {
  if (!isLogTypeEnabled('usage')) return
  if (!sessionId) return

  const key = taskSessionKey(job, sessionId)
  const cursor = readCursor(key)

  const mainPath = sessionTranscriptPath(job.workspace, sessionId)
  const main = mainPath ? await readNewUsage(mainPath, cursor.mainLines) : null

  const parts: UsagePart[] = []
  if (main && hasAnyTokens(main.usage)) {
    parts.push({ source: 'main', usage: main.usage, model: main.model })
  }

  const sub = await readNewSubagentParts(job.workspace, sessionId, cursor.subagentFiles)
  parts.push(...sub.parts)

  const nextCursor = {
    mainLines: main?.totalLines ?? cursor.mainLines,
    subagentFiles: [...cursor.subagentFiles, ...sub.newFiles],
  }

  if (parts.length === 0) {
    writeCursor(key, nextCursor)
    return
  }

  const agg = sumTokenUsage(parts.map((p) => p.usage))
  await recordJobUsage(job, {
    providerId,
    tokens: {
      inputTokens: agg.inputTokens,
      outputTokens: agg.outputTokens,
      cacheReadTokens: agg.cacheReadTokens,
      cacheWriteTokens: agg.cacheWriteTokens,
      totalTokens: totalTokensOf(agg),
    },
    model: lastModelOf(parts),
    sessionId,
    source: 'aggregate',
  })

  writeCursor(key, nextCursor)
}
