/**
 * Contract for reading the conversation history a runner left on disk for one
 * session — what the "chat trực tiếp với runner" panel replays and polls while a
 * step runs (F0013). Each storage format (Claude CLI, Cursor CLI, the transcript
 * `AgenticApiProvider` writes) is one implementation; `transcriptReaders.ts` is
 * the only place that knows which implementation serves which provider.
 *
 * Callers (`taskChat.ts`) depend on this file only.
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
  /** `text` was cut at `MAX_TURN_CHARS`. */
  truncated?: boolean
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

/**
 * Which transcript backend answered — reported verbatim as the chat API's
 * `transcriptProvider`: `'claude-code-cli'`, `'cursor-cli'`, an ai-api provider
 * id, or `'unknown'`.
 */
export type TranscriptProviderLabel = 'claude-code-cli' | 'cursor-cli' | 'unknown' | (string & {})

export interface TranscriptReadResult extends TranscriptResult {
  /** Transcript file that was read; `null` when none was found. */
  file: string | null
  /** Label of the reader that produced this result — a composite reports the one that matched. */
  provider: TranscriptProviderLabel
}

export interface TranscriptReader {
  /** Label this reader reports when nothing is read (no session yet, file missing). */
  readonly label: TranscriptProviderLabel
  /** Locate + read in one call. Missing/unreadable transcript → empty turns, never throws. */
  read(sessionId: string, workspace?: string, opts?: ReadTranscriptOptions): TranscriptReadResult
  /** Shown to the user when a session exists but its transcript is not on disk. */
  missingReason(): string
}

/** Per-turn text cap — a single agent reply can be enormous. */
export const MAX_TURN_CHARS = 4000

/** Trim and cap a turn's text at `MAX_TURN_CHARS`, flagging the cut. */
export function clipTurnText(text: string): { text: string; truncated?: boolean } {
  const t = text.trim()
  if (t.length <= MAX_TURN_CHARS) return { text: t }
  return { text: t.slice(0, MAX_TURN_CHARS), truncated: true }
}
