import { existsSync, joinPath, readTextFileSync, readdirSync } from '../../../core/lib/fileHelper.js'
import os from 'node:os'

/**
 * Read a Claude Code CLI session transcript — the conversation history the CLI
 * itself keeps, which is what the dashboard chat surface replays (design: chat
 * trực tiếp với runner, F0013).
 *
 * Layout written by the CLI:
 *   <config>/projects/<cwd with every non-alphanumeric char → '-'>/<sessionId>.jsonl
 * one JSON object per line. Only `type: 'user' | 'assistant'` lines carry
 * conversation content; the rest (`queue-operation`, `attachment`,
 * `last-prompt`, `ai-title`, `summary`, `system`) are CLI bookkeeping. Lines
 * with `isSidechain: true` belong to a subagent's own conversation, not this
 * one.
 *
 * The file grows while the job runs, so polling it is also how the dashboard
 * monitors a runner mid-flight instead of only seeing the final result.
 */

export type TranscriptRole = 'user' | 'assistant' | 'tool'

export interface TranscriptTurn {
  /** 0-based position among the turns this file yields — the poll cursor. */
  index: number
  role: TranscriptRole
  text: string
  at?: string
  /** Tool name, for `role: 'tool'` activity turns. */
  tool?: string
}

/** Per-turn text cap — a single agent reply can be enormous. */
const MAX_TURN_CHARS = 4000
/** Newest-N turns returned, to bound both memory and payload size. */
const MAX_TURNS = 200
/** Directories scanned when the encoded-path lookup misses. */
const MAX_SCAN_DIRS = 400

function transcriptRoot(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR
  const home = configDir && configDir.trim() ? configDir : joinPath(os.homedir(), '.claude')
  return joinPath(home, 'projects')
}

/** `C:\Users\me\.dev-team-dashboard\x` → `C--Users-me--dev-team-dashboard-x`. */
export function encodeWorkspacePath(workspace: string): string {
  return workspace.replace(/[^A-Za-z0-9]/g, '-')
}

/**
 * Locate `<sessionId>.jsonl`. The encoded workspace directory is tried first;
 * the bounded scan covers drive-letter case differences and jobs whose cwd the
 * caller no longer knows exactly.
 */
export function findTranscriptFile(sessionId: string, workspace?: string): string | null {
  if (!sessionId || /[^\w-]/.test(sessionId)) return null
  const root = transcriptRoot()

  if (workspace) {
    const direct = joinPath(root, encodeWorkspacePath(workspace), `${sessionId}.jsonl`)
    if (existsSync(direct)) return direct
  }

  let dirs: string[]
  try {
    dirs = readdirSync(root)
  } catch {
    return null
  }
  for (const dir of dirs.slice(0, MAX_SCAN_DIRS)) {
    const candidate = joinPath(root, dir, `${sessionId}.jsonl`)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function clip(text: string): string {
  const t = text.trim()
  return t.length > MAX_TURN_CHARS ? `${t.slice(0, MAX_TURN_CHARS)}\n…(đã cắt bớt)` : t
}

/** One-line summary of a tool call — the "agent đang làm gì" signal. */
function describeToolUse(block: Record<string, unknown>): string {
  const input = block.input as Record<string, unknown> | undefined
  for (const key of ['file_path', 'path', 'pattern', 'command', 'description', 'prompt'] as const) {
    const v = input?.[key]
    if (typeof v === 'string' && v.trim()) {
      const oneLine = v.trim().split('\n')[0]
      return oneLine.length > 120 ? `${oneLine.slice(0, 120)}…` : oneLine
    }
  }
  return ''
}

function textOfContent(content: unknown): { text: string; tools: { tool: string; text: string }[] } {
  if (typeof content === 'string') return { text: content, tools: [] }
  if (!Array.isArray(content)) return { text: '', tools: [] }

  const parts: string[] = []
  const tools: { tool: string; text: string }[] = []
  for (const raw of content) {
    const block = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
    if (!block) continue
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    else if (block.type === 'tool_use') {
      tools.push({ tool: typeof block.name === 'string' ? block.name : 'tool', text: describeToolUse(block) })
    }
    // `thinking` and `tool_result` blocks are deliberately dropped: the former
    // is not part of the conversation, the latter is tool plumbing that would
    // bury the actual dialogue.
  }
  return { text: parts.join('\n'), tools }
}

export interface ReadTranscriptOptions {
  /** Only return turns at/after this index (poll cursor). */
  fromIndex?: number
  /** Include `role: 'tool'` activity turns (live monitoring). Default true. */
  includeToolActivity?: boolean
}

export interface TranscriptResult {
  turns: TranscriptTurn[]
  /** Total turn count in the file — the next poll cursor. */
  total: number
}

/** Parse an already-located transcript file into conversation turns. */
export function readTranscript(file: string, opts: ReadTranscriptOptions = {}): TranscriptResult {
  let raw = ''
  try {
    raw = readTextFileSync(file)
  } catch {
    return { turns: [], total: 0 }
  }

  const includeTools = opts.includeToolActivity !== false
  const all: TranscriptTurn[] = []

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(line)
    } catch {
      continue // a half-written trailing line while the CLI is streaming
    }
    if (entry.isSidechain === true) continue
    const type = entry.type
    if (type !== 'user' && type !== 'assistant') continue

    const message = entry.message as Record<string, unknown> | undefined
    const at = typeof entry.timestamp === 'string' ? entry.timestamp : undefined
    const { text, tools } = textOfContent(message?.content)

    if (text.trim()) {
      all.push({ index: all.length, role: type, text: clip(text), at })
    }
    if (includeTools) {
      for (const t of tools) {
        all.push({ index: all.length, role: 'tool', text: t.text, tool: t.tool, at })
      }
    }
  }

  // Re-index after the newest-N window so `index` stays a stable cursor into
  // the returned sequence.
  const windowed = all.slice(Math.max(0, all.length - MAX_TURNS))
  const total = all.length
  const from = opts.fromIndex ?? 0
  return { turns: windowed.filter((t) => t.index >= from), total }
}

/** Convenience: locate + read in one call. Missing transcript → empty result. */
export function readSessionTranscript(
  sessionId: string,
  workspace?: string,
  opts: ReadTranscriptOptions = {},
): TranscriptResult & { file: string | null } {
  const file = findTranscriptFile(sessionId, workspace)
  if (!file) return { turns: [], total: 0, file: null }
  return { ...readTranscript(file, opts), file }
}
