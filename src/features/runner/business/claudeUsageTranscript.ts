import os from 'node:os'
import {
  joinPath,
  readTextFile,
  resolvePath,
  resolvePathUnder,
  safeReadDir,
} from '../../../core/lib/fileHelper.js'

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
