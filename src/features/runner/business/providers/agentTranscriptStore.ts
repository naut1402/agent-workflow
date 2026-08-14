import {
  appendTextFileSync,
  mkdirSync,
  readTextFileSync,
  renameSync,
  joinPath,
  writeTextFileSync,
} from '../../../../core/lib/fileHelper.js'
import { registryHome } from '../../../../core/registry.js'

/**
 * Transcript store for the API-based agentic providers (`AgenticApiProvider`
 * subclasses) — the equivalent of the on-disk JSONL a CLI (Claude/Cursor)
 * writes itself, so `taskChat.ts`/`apiAgentTranscript.ts` (monitor feature)
 * can surface the same `role: 'tool'` activity turns for these providers.
 *
 * Two files per session, both under `registryHome()`:
 *   - `agent-sdk-transcripts/<providerId>/<sessionId>.jsonl` — turns for chat UI.
 *   - `agent-sdk-sessions/<sessionId>.json` — opaque message history for resume.
 */

export interface AgentTranscriptTurn {
  role: 'user' | 'assistant' | 'tool'
  text: string
  /** Tool name, for `role: 'tool'` turns. */
  tool?: string
  at?: string
}

function transcriptDir(providerId: string): string {
  return joinPath(registryHome(), 'agent-sdk-transcripts', providerId)
}

function transcriptFile(providerId: string, sessionId: string): string {
  return joinPath(transcriptDir(providerId), `${sessionId}.jsonl`)
}

function sessionsDir(): string {
  return joinPath(registryHome(), 'agent-sdk-sessions')
}

function sessionFile(sessionId: string): string {
  return joinPath(sessionsDir(), `${sessionId}.json`)
}

/** Best-effort append — disk-full/permission errors must never fail the job. */
export function appendTranscriptTurn(providerId: string, sessionId: string, turn: AgentTranscriptTurn): void {
  try {
    mkdirSync(transcriptDir(providerId), { recursive: true })
    const line = JSON.stringify({ ...turn, at: turn.at ?? new Date().toISOString() })
    appendTextFileSync(transcriptFile(providerId, sessionId), `${line}\n`)
  } catch {
    /* best-effort — transcript bookkeeping must not fail the job */
  }
}

/** Read raw transcript turns for (providerId, sessionId) — missing/corrupt file → []. */
export function readTranscriptTurns(providerId: string, sessionId: string): AgentTranscriptTurn[] {
  let raw: string
  try {
    raw = readTextFileSync(transcriptFile(providerId, sessionId))
  } catch {
    return []
  }
  const turns: AgentTranscriptTurn[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line)
      if (
        entry &&
        (entry.role === 'user' || entry.role === 'assistant' || entry.role === 'tool') &&
        typeof entry.text === 'string'
      ) {
        turns.push({
          role: entry.role,
          text: entry.text,
          tool: typeof entry.tool === 'string' ? entry.tool : undefined,
          at: typeof entry.at === 'string' ? entry.at : undefined,
        })
      }
    } catch {
      continue // a half-written trailing line while the job is still running
    }
  }
  return turns
}

/** Persist opaque message history (subclass-defined shape) for the next resume. Best-effort. */
export function saveSessionMessages(sessionId: string, messages: unknown[]): void {
  try {
    mkdirSync(sessionsDir(), { recursive: true })
    const file = sessionFile(sessionId)
    const tmp = `${file}.tmp`
    writeTextFileSync(tmp, JSON.stringify({ sessionId, messages }, null, 2))
    renameSync(tmp, file)
  } catch {
    /* best-effort */
  }
}

/** Load message history for resume — missing/corrupt file → [] (treated as a fresh session). */
export function loadSessionMessages(sessionId: string): unknown[] {
  try {
    const data = JSON.parse(readTextFileSync(sessionFile(sessionId)))
    return Array.isArray(data?.messages) ? data.messages : []
  } catch {
    return []
  }
}
