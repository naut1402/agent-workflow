import { readTextFile } from '../../../backend/lib/fileHelper.js'
import type { ToolCall } from '../../../shared/log/schema.js'

/**
 * Claude Code CLI transcript reader — pull `tool_use` blocks out of
 * `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` from a line cursor.
 *
 * Sibling of `claudeUsageTranscript.ts` (token deltas) and deliberately NOT a
 * refactor of `monitor/business/sessionTranscript.ts`: `describeToolUse()` there
 * keeps only the first line of a command because the chat view renders one row
 * per turn. Intent analysis needs the whole `&&` chain and the heredoc body, so
 * reusing it would mean changing behaviour the chat screen depends on.
 *
 * Defensive I/O throughout: unreadable file → `null`, bad line → skipped, never
 * throws. `null` and `[]` are different answers — "no transcript" vs "transcript
 * with nothing new" — and `captureJobToolCalls` treats them differently.
 */

export interface ToolCallReadResult {
  calls: ToolCall[]
  /** Physical line count of the file — the cursor for the next read. */
  totalLines: number
}

/**
 * Keys checked in order when turning a tool input into one analysable string.
 * `command` first: Bash is 91% of measured calls and the only input whose shape
 * the intent classifier can read.
 */
const TEXT_KEYS = ['command', 'pattern', 'file_path', 'path', 'query', 'prompt', 'description'] as const

/** Primary argument of a tool call as text; falls back to the raw input JSON. */
export function textOfToolInput(input: unknown): string {
  if (typeof input === 'string') return input
  if (!input || typeof input !== 'object') return ''
  const obj = input as Record<string, unknown>
  for (const key of TEXT_KEYS) {
    const v = obj[key]
    if (typeof v === 'string' && v) return v
  }
  try {
    return JSON.stringify(input)
  } catch {
    return ''
  }
}

function callsFromRow(row: Record<string, unknown>): ToolCall[] {
  const message = row.message
  if (!message || typeof message !== 'object') return []
  const content = (message as Record<string, unknown>).content
  if (!Array.isArray(content)) return []

  const at = typeof row.timestamp === 'string' && row.timestamp ? row.timestamp : null
  // Missing key → `false`, never `undefined`: `sidechain` is how statistics split
  // subagent turns out, and `undefined` would silently fall on the wrong side.
  const sidechain = row.isSidechain === true

  const out: ToolCall[] = []
  for (const raw of content) {
    if (!raw || typeof raw !== 'object') continue
    const block = raw as Record<string, unknown>
    if (block.type !== 'tool_use') continue
    const name = typeof block.name === 'string' ? block.name : ''
    if (!name) continue
    out.push({ name, at, text: textOfToolInput(block.input), sidechain })
  }
  return out
}

/**
 * Read tool calls from `fromLine` (0-based) to EOF.
 *
 * `totalLines` counts only lines that were actually read, so a half-written
 * trailing line is re-read on the next pass once the CLI has finished it.
 */
export async function readNewToolCalls(
  filePath: string,
  fromLine: number,
): Promise<ToolCallReadResult | null> {
  let raw: string
  try {
    raw = await readTextFile(filePath)
  } catch {
    return null
  }

  const lines = raw.split('\n')
  // A trailing newline yields a final empty segment that is not a line.
  const physicalLines = raw.endsWith('\n') ? Math.max(0, lines.length - 1) : lines.length
  const start = Math.max(0, Math.floor(fromLine))

  const calls: ToolCall[] = []
  // The cursor stops at the first unparseable line rather than past it: that line
  // is normally the one the CLI is still writing, and a cursor that jumped over it
  // would drop its calls for good once it is complete. Parsing still continues so
  // one bad line in the middle does not hide everything after it.
  let firstBadLine = -1
  for (let i = start; i < physicalLines; i++) {
    const line = lines[i]
    if (!line || !line.trim()) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      if (firstBadLine < 0) firstBadLine = i
      continue
    }
    if (!parsed || typeof parsed !== 'object') continue
    const row = parsed as Record<string, unknown>
    if (row.type !== 'assistant') continue
    calls.push(...callsFromRow(row))
  }

  return { calls, totalLines: firstBadLine >= 0 ? firstBadLine : physicalLines }
}
