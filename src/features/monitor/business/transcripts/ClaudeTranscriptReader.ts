import { existsSync, joinPath, readdirSync } from '../../../../backend/lib/fileHelper.js'
import os from 'node:os'
import { AbstractJsonlTranscriptReader, isSafeSessionId, type TranscriptTurnDraft } from './AbstractJsonlTranscriptReader.js'

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
  if (!isSafeSessionId(sessionId)) return null
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

export class ClaudeTranscriptReader extends AbstractJsonlTranscriptReader {
  readonly label = 'claude-code-cli'

  protected locate(sessionId: string, workspace?: string): string | null {
    return findTranscriptFile(sessionId, workspace)
  }

  protected turnsOfEntry(entry: Record<string, unknown>, includeToolActivity: boolean): TranscriptTurnDraft[] {
    if (entry.isSidechain === true) return []
    const type = entry.type
    if (type !== 'user' && type !== 'assistant') return []

    const message = entry.message as Record<string, unknown> | undefined
    const at = typeof entry.timestamp === 'string' ? entry.timestamp : undefined
    const { text, tools } = textOfContent(message?.content)

    const turns: TranscriptTurnDraft[] = []
    if (text.trim()) turns.push({ role: type, ...this.clip(text), at })
    if (includeToolActivity) {
      for (const t of tools) turns.push({ role: 'tool', text: t.text, tool: t.tool, at })
    }
    return turns
  }
}
