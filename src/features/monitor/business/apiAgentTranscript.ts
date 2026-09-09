import { joinPath, readTextFileSync } from '../../../core/lib/fileHelper.js'
import { registryHome } from '../../../core/registry.js'
import type { TranscriptResult, TranscriptTurn } from './sessionTranscript.js'

/**
 * Read the transcript an `AgenticApiProvider` subclass (openai/gemini/xai/anthropic
 * — see runner/business/providers/agenticApiProvider.ts) wrote for a job, so task
 * chat can surface its tool-calls the same way it does for a CLI's own on-disk
 * transcript (sessionTranscript.ts / cursorSessionTranscript.ts). Read-only
 * counterpart of `agentTranscriptStore.ts::appendTranscriptTurn` — kept in
 * `monitor` (not `runner`) to match where the other transcript readers live.
 */

const MAX_TURN_CHARS = 4000
const MAX_TURNS = 200

function transcriptFile(providerId: string, sessionId: string): string {
  return joinPath(registryHome(), 'agent-sdk-transcripts', providerId, `${sessionId}.jsonl`)
}

function clip(text: string): string {
  const t = text.trim()
  return t.length > MAX_TURN_CHARS ? `${t.slice(0, MAX_TURN_CHARS)}\n…(đã cắt bớt)` : t
}

export interface ReadApiAgentTranscriptOptions {
  fromIndex?: number
  /** Include `role: 'tool'` activity turns. Default true. */
  includeToolActivity?: boolean
}

/** Parse `<providerId>/<sessionId>.jsonl` into turns — missing/corrupt file → []. Never throws. */
export function readApiAgentTranscript(
  providerId: string,
  sessionId: string,
  opts: ReadApiAgentTranscriptOptions = {},
): TranscriptResult & { file: string | null } {
  const file = transcriptFile(providerId, sessionId)
  let raw: string
  try {
    raw = readTextFileSync(file)
  } catch {
    return { turns: [], total: 0, file: null }
  }

  const includeTools = opts.includeToolActivity !== false
  const all: TranscriptTurn[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(line)
    } catch {
      continue // half-written trailing line while the job is still running
    }
    const role = entry.role
    if (role !== 'user' && role !== 'assistant' && role !== 'tool') continue
    if (role === 'tool' && !includeTools) continue
    const text = typeof entry.text === 'string' ? entry.text : ''
    if (!text.trim()) continue
    all.push({
      index: all.length,
      role,
      text: clip(text),
      tool: typeof entry.tool === 'string' ? entry.tool : undefined,
      at: typeof entry.at === 'string' ? entry.at : undefined,
    })
  }

  const windowed = all.slice(Math.max(0, all.length - MAX_TURNS))
  const total = all.length
  const from = opts.fromIndex ?? 0
  return { turns: windowed.filter((t) => t.index >= from), total, file }
}
