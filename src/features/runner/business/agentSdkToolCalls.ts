import { readTextFile, resolvePathUnder } from '../../../backend/lib/fileHelper.js'
import { registryHome } from '../../../backend/registry.js'
import type { ToolCall } from '../../../shared/log/schema.js'
import { textOfToolInput } from './claudeToolTranscript.js'

/**
 * Tool-call reader for the API-based agentic providers — `agent-sdk-sessions/
 * <sessionId>.json`, written by `providers/agentTranscriptStore.ts`.
 *
 * This is the second of two ingest sources, and not a rare branch: 131 of the
 * measured jobs ran on a non-`claude-code-cli` provider, and the request covers
 * "every job, including the ones started from the chat box".
 *
 * Two message shapes live in the same file because the shape is whatever the
 * provider subclass persisted:
 *   - OpenAI-compatible  — `msg.tool_calls[] = { function: { name, arguments } }`
 *   - Anthropic-compatible — `msg.content[]` blocks `{ type: 'tool_use', name, input }`
 *
 * `at` is always `null`: the file keeps no per-call timestamp. Bigrams still work
 * (array order is time order); only hour-of-day style metrics do not apply.
 */

/**
 * `resolvePathUnder` already rejects `..`, but `a/b` resolves to a real path
 * INSIDE the sessions dir, so it would pass. A session id is a flat file name —
 * reject every separator outright.
 */
export function agentSdkSessionPath(sessionId: string): string | null {
  if (typeof sessionId !== 'string' || !sessionId) return null
  if (sessionId.includes('/') || sessionId.includes('\\') || sessionId.includes('..')) return null
  if (sessionId.includes('\0')) return null
  return resolvePathUnder(registryHome(), 'agent-sdk-sessions', `${sessionId}.json`)
}

/** OpenAI `function.arguments` is a JSON string; unparseable → use it verbatim. */
function textOfArguments(args: unknown): string {
  if (typeof args !== 'string') return textOfToolInput(args)
  if (!args.trim()) return ''
  try {
    return textOfToolInput(JSON.parse(args))
  } catch {
    return args
  }
}

function callsFromMessage(raw: unknown): ToolCall[] {
  if (!raw || typeof raw !== 'object') return []
  const msg = raw as Record<string, unknown>
  const out: ToolCall[] = []

  if (Array.isArray(msg.tool_calls)) {
    for (const entry of msg.tool_calls) {
      if (!entry || typeof entry !== 'object') continue
      const fn = (entry as Record<string, unknown>).function
      if (!fn || typeof fn !== 'object') continue
      const f = fn as Record<string, unknown>
      const name = typeof f.name === 'string' ? f.name : ''
      if (!name) continue
      out.push({ name, at: null, text: textOfArguments(f.arguments), sidechain: false })
    }
  }

  if (Array.isArray(msg.content)) {
    for (const entry of msg.content) {
      if (!entry || typeof entry !== 'object') continue
      const block = entry as Record<string, unknown>
      if (block.type !== 'tool_use') continue
      const name = typeof block.name === 'string' ? block.name : ''
      if (!name) continue
      out.push({ name, at: null, text: textOfToolInput(block.input), sidechain: false })
    }
  }

  return out
}

/**
 * Every tool call in a session file, in array order. Missing / corrupt file → `[]`.
 *
 * Reads the WHOLE file rather than a cursor slice: `saveSessionMessages` rewrites
 * it in full on every turn, so there is no stable line offset to resume from.
 * Dedupe of the repeats that causes lives in `toolCallCapture.ts`.
 */
export async function readSessionToolCalls(sessionId: string): Promise<ToolCall[]> {
  const file = agentSdkSessionPath(sessionId)
  if (!file) return []

  let raw: string
  try {
    raw = await readTextFile(file)
  } catch {
    return []
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object') return []

  const messages = (parsed as Record<string, unknown>).messages
  if (!Array.isArray(messages)) return []

  const out: ToolCall[] = []
  for (const msg of messages) out.push(...callsFromMessage(msg))
  return out
}
