import { appendToolCallLog } from '../../../backend/log/store.js'
import { isLogTypeEnabled } from '../../../backend/log/loggingPrefsIo.js'
import {
  SENSITIVE_KEY_RE,
  TOOL_CALL_MAX_CALLS,
  TOOL_CALL_TEXT_BUDGET,
  TOOL_CALL_TEXT_MAX_CHARS,
  type ToolCall,
  type ToolCallLogEntry,
} from '../../../shared/log/schema.js'
import { statSafe } from '../../../backend/lib/fileHelper.js'
import { agentSdkSessionPath, readSessionToolCalls } from './agentSdkToolCalls.js'
import { readNewToolCalls } from './claudeToolTranscript.js'
import { sessionTranscriptPath } from './claudeUsageTranscript.js'
import { getToolCallCursor, setToolCallCursor } from './sessionLedger.js'
import type { JobRecord } from './types.js'

/**
 * Tool-call ingest for a finished job — the mirror image of `captureJobUsage`,
 * down to its invariants:
 *   - never throws to the caller (`jobQueue` calls it fire-and-forget),
 *   - exits early when the log type is off or there is no session id.
 *
 * It writes ONE entry per job (see `ToolCallLogEntry`), and unlike
 * `captureJobUsage` it is not limited to `claude-code-cli`: the agent-SDK adapter
 * covers every other provider.
 *
 * It also does NOT walk `subagents/` the way usage capture does — the main
 * transcript already carries the subagent blocks with `isSidechain: true`, and the
 * `sidechain` flag on each call is enough to split them in the statistics. Reading
 * the directory too would count them twice.
 */

type ToolCallSource = 'cli-transcript' | 'agent-sdk-session'

/** A `tool-call` entry without the stamps the log writer adds. */
export type ToolCallEntryPayload = Omit<ToolCallLogEntry, 'type' | 'ts' | 'iso' | 'level' | 'traceId'>

/**
 * `no-source` and `empty` are different answers and callers act on both: the first
 * means "nothing to read here" (pruned transcript, wrong adapter), the second means
 * "read fine, nothing new". Collapsing them is what let the backfill lose 82 jobs
 * without a word.
 */
export type BuildToolCallResult =
  | { status: 'no-source' }
  | { status: 'empty'; nextCursor: number }
  | { status: 'ok'; payload: ToolCallEntryPayload; nextCursor: number }

/** A non-empty string from `job.metadata`, or `null` — missing and `''` are the same here. */
function metaString(job: JobRecord, key: string): string | null {
  const v = job.metadata?.[key]
  return typeof v === 'string' && v ? v : null
}

/**
 * Same two metadata keys as `jobQueue.stepIdOf`, resolved locally on purpose:
 * importing `jobQueue` (even dynamically) runs `startRecoverPoller()`, which the
 * backfill path — a read-only CLI — has no business starting.
 *
 * ⚠️ Second copy. Adding a key in `jobQueue.stepIdOf` means adding it here too.
 */
function stepIdOf(job: JobRecord): string | null {
  return metaString(job, 'stepId') ?? metaString(job, 'pipelineStepId')
}

// ── Redaction ────────────────────────────────────────────────────────────────

const REDACTED = '[redacted]'

/**
 * `SENSITIVE_KEY_RE` bounded by `-`/`_`/string-edge instead of by nothing, so it
 * matches a whole WORD of an identifier rather than any substring. Built from the
 * SAME source, so there is still exactly one rule set.
 *
 * The boundaries are what make `PATH` and `--patch` safe (`pat` is followed by
 * `H`/`c`, not by a separator). Splitting the name on `-`/`_` and testing the
 * parts separately looks equivalent but is NOT: it tears the two-word key
 * `api[-_]?key` in half, so `X-Api-Key`, `GITHUB_API_KEY` and `x_api_key` all stop
 * matching. One regex over the whole name keeps multi-word keys intact.
 */
const SENSITIVE_NAME_RE = new RegExp(`(?:^|[-_])(?:${SENSITIVE_KEY_RE.source})(?:[-_]|$)`, 'i')

/** Is this identifier a secret holder? `--patch`, `--path` and `PATH` are not. */
function isSensitiveName(name: string): boolean {
  return !!name && SENSITIVE_NAME_RE.test(name.replace(/^-+/, ''))
}

/** `-H '…'` / `--header="…"` carrying a quoted header value. */
const QUOTED_HEADER_RE = /((?:-H|--header)(?:\s*=\s*|\s+))(["'])([^"']*)\2/gi
/** `-H Authorization:xyz` without quotes (value cannot contain a space). */
const BARE_AUTH_HEADER_RE = /((?:-H|--header)(?:\s*=\s*|\s+))(authorization\s*:\s*)(\S+)/gi
/**
 * `Bearer <token>` anywhere, not just behind `-H`. This is the rule that catches
 * `echo "Authorization: Bearer sk-x"` and `--data-raw 'token=Bearer sk-x'`, where
 * the value contains a SPACE — the key/value rule below stops at that space and
 * would leave the token in plain sight next to a `[redacted]` that makes the line
 * look clean, which is worse than not redacting at all.
 */
const AUTH_SCHEME_RE = /\b(bearer|basic|token)\s+(?!\[redacted)([^\s"']+)/gi
/**
 * `--password hunter2`, `--api-key abc` — sensitive flag, value separated by a space.
 *
 * The sensitive-name test is baked into the PATTERN on purpose. Matching every
 * flag and then rejecting it in the replacer looks the same but leaks: this regex
 * is global, so a non-sensitive match still CONSUMES its input, and
 * `curl -s --password X` would have `-s --password` eaten as one match and leave
 * `X` untouched. `curl --password X` redacted while `curl -s --password X` did not.
 *
 * ⚠️ `SENSITIVE_KEY_RE.source` contributes its OWN capture group, so the groups
 * here are 1=flag, 2=(the matched key word), 3=separator, 4=quote, 5=value — the
 * quote backreference is \\4, not \\3. Getting that wrong does not fail loudly; it
 * silently splices the key word back into the output (`--api-keyapi-key`).
 */
const SENSITIVE_FLAG_RE = new RegExp(
  `(--?[A-Za-z0-9_-]*(?:^|[-_])(?:${SENSITIVE_KEY_RE.source})(?:[-_][A-Za-z0-9_-]*)?)`
    + `(\\s*=\\s*|\\s+)(["']?)(?!\\[redacted)([^\\s"']+)\\4`,
  'gi',
)
/** `key=value` / `"key": "value"` — key tested with `isSensitiveName`. */
const KEY_VALUE_RE = /(["']?)([A-Za-z0-9_.-]+)\1(\s*[:=]\s*)(?:(["'])([^"']*)\4|([^\s,;&}\]"']+))/g

/**
 * Filesystem paths are not secrets. Without this guard a flag like `--key-file
 * ./ci.pem` would come back redacted and the command analysis would lose the path
 * it exists to count.
 */
function looksLikePath(value: string): boolean {
  return value.startsWith('~') || value.includes('/')
}

/** `schema.ts`, `README.md`, `package.json` — an argument, not a secret. */
function hasFileExt(value: string): boolean {
  return /\.[A-Za-z0-9]{1,8}$/.test(value)
}

/**
 * `bearer` and `basic` before a value are HTTP auth schemes and nothing else, so
 * they redact unconditionally — `Bearer sk-abc` must not survive on a length rule.
 * A bare `token` is also an ordinary English word, so there it only fires on
 * something that actually looks like a credential.
 *
 * The file-extension and digit tests exist because `grep -n token schema.ts` was
 * coming back as `token [redacted]`, which silently emptied `fileNamesIn()` and
 * with it the whole bootstrap table — the evidence `get_task_context` rests on.
 */
function looksLikeCredential(value: string): boolean {
  return value.length >= 8 && !looksLikePath(value) && !hasFileExt(value) && /\d/.test(value)
}

/**
 * Strip secrets from a command before it is stored.
 *
 * Mandatory, not optional: the measured `curl` calls carry auth headers, and the
 * investigation found a plaintext `NOTION_TOKEN` on disk. Bash is the single most
 * reliable secret-leak channel in this entry.
 *
 * The invariant runs BOTH ways. Secrets must disappear, and paths / git SHAs /
 * long non-secret strings must survive untouched — redacting everything long would
 * gut the command analysis this log exists for. The sensitive-name list is
 * `SENSITIVE_KEY_RE` from `shared/log/schema.ts`: one rule set, reused, never
 * copied.
 *
 * Order matters. `AUTH_SCHEME_RE` runs FIRST because the later rules replace the
 * scheme word itself, and once `Bearer` is gone there is nothing left to anchor
 * the token to.
 */
export function redactToolText(raw: string): string {
  return redactAtDepth(raw, 0)
}

/**
 * How deep the non-sensitive-key rescan may nest.
 *
 * The rescan below recurses on the VALUE of a non-sensitive key, which shrinks by at
 * least the key and separator each time — so it terminates, but `a=a=a=…` nests once
 * per pair and ~2 500 of them overflowed the stack. `prepareCalls` redacts BEFORE
 * capping text, so the input length is whatever the agent ran, not `TOOL_CALL_TEXT_MAX_CHARS`;
 * the backfill path (`walkTranscripts`) has no try/catch, so an overflow there aborts
 * `--ingest` outright. Real commands nest once or twice — a URL inside a quoted JSON
 * value is depth 2 — so 8 is far above anything measured.
 */
const MAX_REDACT_DEPTH = 8

/**
 * A value the rescan ran out of depth on — kept only if it holds no sensitive word.
 *
 * Tested with the bare `SENSITIVE_KEY_RE` rather than `isSensitiveName`, which anchors
 * the word to `-`/`_`/string edges and so would answer "not sensitive" for exactly the
 * nested shape that got us here (`a=api_key=…` has `=` on both sides). This is the
 * fail-closed branch, so the loose test is the right one.
 */
function cappedValue(value: string): string {
  return SENSITIVE_KEY_RE.test(value) ? REDACTED : value
}

/**
 * The redaction pipeline itself. `depth` tracks the non-sensitive-key rescan below
 * and is the ONLY reason this is not simply `redactToolText` — see `MAX_REDACT_DEPTH`.
 */
function redactAtDepth(raw: string, depth: number): string {
  if (typeof raw !== 'string' || !raw) return ''

  let out = raw.replace(AUTH_SCHEME_RE, (match, scheme: string, value: string) => {
    if (scheme.toLowerCase() === 'token' && !looksLikeCredential(value)) return match
    return `${scheme} ${REDACTED}`
  })

  out = out.replace(QUOTED_HEADER_RE, (match, flag: string, quote: string, content: string) => {
    if (!/authorization\s*:/i.test(content)) return match
    const masked = content.replace(/(authorization\s*:\s*)([\s\S]*)$/i, `$1${REDACTED}`)
    return `${flag}${quote}${masked}${quote}`
  })

  out = out.replace(BARE_AUTH_HEADER_RE, (_m, flag: string, key: string) => `${flag}${key}${REDACTED}`)

  // Group 2 is the key word captured inside `SENSITIVE_KEY_RE.source` — skipped,
  // not used. The pattern already guarantees the flag is sensitive.
  out = out.replace(
    SENSITIVE_FLAG_RE,
    (match, flag: string, _key: string, sep: string, quote: string, value: string) =>
      looksLikePath(value) ? match : `${flag}${sep}${quote}${REDACTED}${quote}`,
  )

  out = out.replace(
    KEY_VALUE_RE,
    (match, openQuote: string, key: string, sep: string, valQuote: string, quoted: string, bare: string) => {
      const value = valQuote ? quoted : bare
      if (!isSensitiveName(key)) {
        // `String.replace` collects every match BEFORE calling this, so rescanning
        // the value here cannot disturb the outer pass. Without it a secret behind a
        // harmless key is skipped whole: in `curl "https://x/v1?api_key=abc"` the
        // match starts at the key `https`, and the matched span is never re-examined.
        const prefix = `${openQuote}${key}${openQuote}${sep}`
        const inner = depth >= MAX_REDACT_DEPTH ? cappedValue(value) : redactAtDepth(value, depth + 1)
        return `${prefix}${valQuote || ''}${inner}${valQuote || ''}`
      }
      if (!value || looksLikePath(value)) return match
      // The rules above already ran; re-redacting their output would nest brackets.
      if (value.startsWith('[redacted')) return match
      return valQuote
        ? `${openQuote}${key}${openQuote}${sep}${valQuote}${REDACTED}${valQuote}`
        : `${openQuote}${key}${openQuote}${sep}${REDACTED}`
    },
  )

  out = out.replace(/((?:^|\s)(?:-u\s*|--user(?:=|\s+)))(?:"[^"]*"|'[^']*'|[^\s"']+)/g, `$1${REDACTED}`)
  out = out.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@"']+@/gi, `$1${REDACTED}@`)
  out = out.replace(/(^|[\s"'=])[^\s/:@"']+:[^\s/@"']+@/g, `$1${REDACTED}@`)

  return out
}

// ── Entry assembly ───────────────────────────────────────────────────────────

/** Cap to exactly `max` characters — the ellipsis replaces the last kept one. */
function capText(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

/**
 * Redact → cap each `text` → cap the entry's total text budget → cap the call
 * count. Redaction runs FIRST so a secret sitting past the per-call cap cannot
 * survive by being truncated into the stored prefix.
 */
export function prepareCalls(calls: ToolCall[]): { calls: ToolCall[]; callsTotal: number } {
  const callsTotal = calls.length
  const kept = calls.slice(0, TOOL_CALL_MAX_CALLS)

  let budget = TOOL_CALL_TEXT_BUDGET
  const out: ToolCall[] = kept.map((call) => {
    const text = capText(redactToolText(call.text), TOOL_CALL_TEXT_MAX_CHARS)
    if (text.length > budget) {
      // Past the budget the call still counts — only its text is dropped.
      budget = 0
      return { ...call, text: '' }
    }
    budget -= text.length
    return { ...call, text }
  })

  return { calls: out, callsTotal }
}

// ── Ingest ───────────────────────────────────────────────────────────────────

/**
 * The cursor means different things per source, which is why it is one number
 * rather than a line offset everywhere:
 *   - `cli-transcript`    — lines of the JSONL already read (the file only grows),
 *   - `agent-sdk-session` — CALLS already attributed (the file is rewritten whole
 *     on every turn, so there is no stable line offset).
 *
 * Both readings answer the same question — "where did the last ingest stop" — so
 * they share `toolCallCursor.mainLines`, and neither double-counts a resumed
 * session. Before the agent-SDK branch had a cursor, job *n* on a session re-read
 * every call jobs 1…n−1 had already logged, inflating every total by O(n²).
 */
async function readCalls(
  job: JobRecord,
  sessionId: string,
  providerId: string,
  fromCursor: number,
): Promise<{ calls: ToolCall[]; source: ToolCallSource; nextCursor: number } | null> {
  if (providerId === 'claude-code-cli') {
    // Reuse `sessionTranscriptPath` — it already blocks path traversal through
    // `resolvePathUnder` and validates the session id. Never hand-build a path
    // into `~/.claude/projects`.
    const path = sessionTranscriptPath(job.workspace, sessionId)
    if (!path) return null
    const result = await readNewToolCalls(path, fromCursor)
    if (!result) return null
    return { calls: result.calls, source: 'cli-transcript', nextCursor: result.totalLines }
  }

  const all = await readSessionToolCalls(sessionId)
  if (all.length === 0) {
    // `readSessionToolCalls` returns [] for BOTH "no such file" and "file with no
    // tool calls". Only the first is `no-source`; probing keeps the counters
    // meaning the same thing here as on the CLI branch, where a readable
    // transcript with nothing in it is `empty`.
    const file = agentSdkSessionPath(sessionId)
    if (!file || !(await statSafe(file)).exists) return null
    return { calls: [], source: 'agent-sdk-session', nextCursor: 0 }
  }
  return {
    calls: all.slice(Math.max(0, fromCursor)),
    source: 'agent-sdk-session',
    nextCursor: all.length,
  }
}

/**
 * Read one job's calls and shape them into an entry payload — no writes, so the
 * read-only `--from-transcripts` path can reuse it.
 */
export async function buildJobToolCallEntry(
  job: JobRecord,
  sessionId: string,
  providerId: string,
  fromCursor = 0,
): Promise<BuildToolCallResult> {
  if (!sessionId) return { status: 'no-source' }

  const read = await readCalls(job, sessionId, providerId, fromCursor)
  if (!read) return { status: 'no-source' }
  if (read.calls.length === 0) return { status: 'empty', nextCursor: read.nextCursor }

  const { calls, callsTotal } = prepareCalls(read.calls)
  return {
    status: 'ok',
    nextCursor: read.nextCursor,
    payload: {
      jobId: job.id,
      sessionId,
      taskId: metaString(job, 'taskId'),
      projectId: metaString(job, 'projectId'),
      stepId: stepIdOf(job),
      agentRef: job.agentRef ?? null,
      provider: providerId,
      source: read.source,
      callsTotal,
      calls,
    },
  }
}

/**
 * Ingest one job's tool calls at runtime. Returns `true` when an entry was written.
 *
 * Writes nothing for a job with no new calls: an empty entry would inflate
 * `coverage.jobs` with jobs that used no tools at all.
 *
 * ⚠️ Known limit: the cursor lives on the TASK session ledger, so it only engages
 * when the job carries both `projectId` and `taskId`. A chat-box job missing either
 * one re-reads its source from the start on every resume, and the duplicates that
 * follow are invisible to `coverage`. Backfill does not share this hole — it keeps
 * its own per-session cursor for the length of the run.
 */
export async function ingestJobToolCalls(
  job: JobRecord,
  sessionId: string,
  providerId: string,
): Promise<boolean> {
  if (!isLogTypeEnabled('tool-call')) return false
  if (!sessionId) return false

  const projectId = metaString(job, 'projectId')
  const taskId = metaString(job, 'taskId')
  const tracked = Boolean(projectId && taskId)
  const fromCursor = tracked ? getToolCallCursor(projectId!, taskId!, sessionId)?.mainLines ?? 0 : 0

  const built = await buildJobToolCallEntry(job, sessionId, providerId, fromCursor)
  // `no-source` leaves the cursor alone so a transcript that comes back is still
  // readable; losing one job beats corrupting the cursor for every later job on
  // the same session.
  if (built.status === 'no-source') return false

  const advanceCursor = () => {
    if (tracked) setToolCallCursor(projectId!, taskId!, sessionId, { mainLines: built.nextCursor })
  }

  if (built.status === 'empty') {
    advanceCursor()
    return false
  }

  await appendToolCallLog(built.payload)
  advanceCursor()
  return true
}

/**
 * `jobQueue` entry point. Swallows everything: tool-call ingest is bookkeeping and
 * must never turn into a job failure or an unhandled rejection.
 */
export async function captureJobToolCalls(
  job: JobRecord,
  sessionId: string,
  providerId: string,
): Promise<void> {
  try {
    await ingestJobToolCalls(job, sessionId, providerId)
  } catch {
    /* swallow — see `captureJobUsage` for the same contract */
  }
}
