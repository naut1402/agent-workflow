import { parseCursorJsonOutput, providerFamilyOf } from '../index.js'
import { ApiAgentTranscriptReader } from './ApiAgentTranscriptReader.js'
import { ClaudeTranscriptReader } from './ClaudeTranscriptReader.js'
import { CursorTranscriptReader, stripCursorUserWrapper } from './CursorTranscriptReader.js'
import { FallbackTranscriptReader } from './FallbackTranscriptReader.js'
import type { TranscriptReader } from './TranscriptReader.js'

/**
 * The one place that knows which `TranscriptReader` implementation serves which
 * runner provider (#441). Callers ask `transcriptReaderFor(providerId)` and
 * only see the `TranscriptReader` contract.
 *
 * Đợt 2 (#440): khi `RunnerProvider.transcriptFormat` + `transcriptFormatOf()`
 * có ở barrel runner, `transcriptReaderFor` tra theo format thay cho bảng id và
 * nhánh `providerFamilyOf` dưới đây — chỉ file này đổi.
 */

const claude = new ClaudeTranscriptReader()
const cursor = new CursorTranscriptReader()

/** Claude's layout first, then Cursor's — the session may have been written by either CLI. */
const claudeThenCursor = new FallbackTranscriptReader('claude-code-cli', [claude, cursor])
/** Same chain for a provider without a reader of its own (`codex-cli` included), labelled `'unknown'`. */
const unknownProvider = new FallbackTranscriptReader('unknown', [claude, cursor])

/** CLI providers with a dedicated reader, by provider id. */
const readerByProviderId = new Map<string, TranscriptReader>([
  ['cursor-cli', cursor],
  ['claude-code-cli', claudeThenCursor],
])

/**
 * Reader for the session's provider. No provider id recorded → Claude (the
 * historical default); an `ai-api` family id (`providerFamilyOf`, runner's
 * source of truth for `AgenticApiProvider` ids) → that provider's transcript.
 */
export function transcriptReaderFor(providerId: string | null | undefined): TranscriptReader {
  if (!providerId) return claudeThenCursor
  const own = readerByProviderId.get(providerId)
  if (own) return own
  if (providerFamilyOf(providerId) === 'ai-api') return new ApiAgentTranscriptReader(providerId)
  return unknownProvider
}

/** Prefer Cursor/agent JSON `result` field when stdout is still raw JSON. */
function extractAgentText(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const parsed = parseCursorJsonOutput(trimmed)
  if (typeof parsed.result === 'string' && parsed.result.trim()) return parsed.result.trim()
  return trimmed
}

/**
 * Agent reply text out of a finished job's raw stdout / log section — used when
 * no transcript file covers the job. Applied to every provider, as before:
 * Cursor JSON `result` unwrapped, `<user_query>` framing stripped.
 */
export function cleanAgentReply(raw: string): string {
  return stripCursorUserWrapper(extractAgentText(raw))
}
