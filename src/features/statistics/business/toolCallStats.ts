import {
  joinPath,
  readTextFile,
  resolvePathUnder,
  safeReadDir,
  statSafe,
} from '../../../backend/lib/fileHelper.js'
import { isLogTypeEnabled } from '../../../backend/log/loggingPrefsIo.js'
import { registryHome } from '../../../backend/registry.js'
import type { ToolCallEntryPayload } from '../../runner/business/toolCallCapture.js'
import type { JobRecord } from '../../runner/business/types.js'
import type { ToolCall, ToolCallLogEntry } from '../../../shared/log/schema.js'
import { readLogs } from '../../logs/business/store.js'
import { classifyBashCall, primaryIntentOf } from '../lib/bashIntent.js'
import type {
  Bigram,
  BootstrapFile,
  ToolFrequency,
  ToolUsageReport,
} from '../schemas/toolCallStats.js'
import { parseTimeBoundMs } from './usageStats.js'

/**
 * Tool-usage analysis over the `tool-call` log.
 *
 * Reading goes through `readLogs`, so it follows whichever driver is active
 * (JSONL or SQLite) instead of hard-coding one. That is the whole point of
 * putting the data in the log in the first place: "next time you should not have
 * to read every transcript to get the numbers".
 */

/** Default read cap — one entry per job, so this is "last N jobs with tool calls". */
const DEFAULT_ENTRY_LIMIT = 5_000

/** How many leading calls of a job count as its bootstrap sequence. */
const BOOTSTRAP_CALLS = 3

/** Sessions counted in `perSession.top10Share`. */
const HEAVY_SESSIONS = 10

const MCP_PREFIX = 'mcp__'

export interface ReadToolCallEntriesOptions {
  from?: string
  to?: string
  projectId?: string
  taskId?: string
  agentRef?: string
  /** Sessions to drop — above all the session running the analysis itself. */
  excludeSessionIds?: string[]
  limit?: number
}

export interface AggregateOptions {
  /** Subagent calls are excluded by default; they inflate every per-session number. */
  includeSidechain?: boolean
}

/**
 * Read `tool-call` entries, newest first, with the filters the CLI exposes.
 *
 * Returns `[]` rather than throwing when the log type is off — the caller is
 * expected to say so out loud instead of printing an unexplained empty table.
 */
export async function readToolCallEntries(
  opts: ReadToolCallEntriesOptions = {},
): Promise<ToolCallLogEntry[]> {
  if (!isLogTypeEnabled('tool-call')) return []

  const entries = await readLogs({ type: 'tool-call', limit: opts.limit ?? DEFAULT_ENTRY_LIMIT })
  const fromMs = opts.from ? parseTimeBoundMs(opts.from) : null
  const toMs = opts.to ? parseTimeBoundMs(opts.to) : null
  const excluded = new Set(opts.excludeSessionIds?.filter(Boolean) ?? [])

  const out: ToolCallLogEntry[] = []
  for (const entry of entries) {
    if (entry.type !== 'tool-call') continue
    if (fromMs !== null && entry.ts < fromMs) continue
    if (toMs !== null && entry.ts > toMs) continue
    if (opts.projectId && entry.projectId !== opts.projectId) continue
    if (opts.taskId && entry.taskId !== opts.taskId) continue
    if (opts.agentRef && entry.agentRef !== opts.agentRef) continue
    // G7: the session running this analysis writes tool calls while it reads them;
    // counting itself was a measured source of drift during the investigation.
    if (entry.sessionId && excluded.has(entry.sessionId)) continue
    out.push(entry)
  }
  return out
}

// ── Aggregation helpers ──────────────────────────────────────────────────────

function callsOf(entry: ToolCallLogEntry, includeSidechain: boolean): ToolCall[] {
  return includeSidechain ? entry.calls : entry.calls.filter((c) => !c.sidechain)
}

/** A session key that still works for entries written without a session id. */
function sessionKeyOf(entry: ToolCallLogEntry): string {
  return entry.sessionId || entry.jobId
}

function shareOf(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0
}

function frequencyRows(
  counts: Map<string, number>,
  sessions: Map<string, Set<string>>,
  total: number,
): ToolFrequency[] {
  return [...counts.entries()]
    .map(([name, calls]) => ({
      name,
      calls,
      share: shareOf(calls, total),
      sessions: sessions.get(name)?.size ?? 0,
    }))
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name))
}

/**
 * The label a call contributes to the sequence analysis: for Bash the intent it
 * serves, for anything else the tool name. Every call takes exactly one slot, so
 * a pair count of `n - 1` per entry holds whatever the calls were.
 */
function sequenceLabelOf(call: ToolCall): string {
  if (call.name !== 'Bash') return call.name
  return primaryIntentOf(call.text) ?? 'bash'
}

const SURVEY_LABELS = new Set(['read', 'grep'])

/** Filenames mentioned in a call — `cat /a/T1/request.md` yields `request.md`. */
function fileNamesIn(text: string): string[] {
  const out = new Set<string>()
  for (const match of text.matchAll(/[\w@.\-/]+\.[A-Za-z0-9]{1,8}\b/g)) {
    const base = match[0].split('/').pop()
    if (base && base.includes('.')) out.add(base)
  }
  return [...out]
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// ── Aggregation ──────────────────────────────────────────────────────────────

/**
 * Turn entries into the report `request.md` asks for: what gets called, what the
 * Bash calls actually do, which pairs repeat, what a session costs, what every
 * job reads first, and whether MCP is used at all.
 */
export function aggregateToolUsage(
  entries: ToolCallLogEntry[],
  opts: AggregateOptions = {},
): ToolUsageReport {
  const includeSidechain = opts.includeSidechain === true

  const toolCalls = new Map<string, number>()
  const toolSessions = new Map<string, Set<string>>()
  const intentCalls = new Map<string, number>()
  const bigramCounts = new Map<string, number>()
  const bootstrapReads = new Map<string, number>()
  const bootstrapSessions = new Map<string, Set<string>>()
  const bashBySession = new Map<string, number>()

  let totalCalls = 0
  let bashCalls = 0
  let mcpCalls = 0
  let totalPairs = 0
  let surveyPairs = 0
  let truncatedEntries = 0
  let firstTs: number | null = null
  let lastTs: number | null = null
  const jobIds = new Set<string>()
  const mcpByTool = new Map<string, number>()
  const mcpByToolSessions = new Map<string, Set<string>>()

  for (const entry of entries) {
    jobIds.add(entry.jobId)
    if (entry.callsTotal > entry.calls.length) truncatedEntries++
    if (firstTs === null || entry.ts < firstTs) firstTs = entry.ts
    if (lastTs === null || entry.ts > lastTs) lastTs = entry.ts

    const session = sessionKeyOf(entry)
    const calls = callsOf(entry, includeSidechain)

    for (const call of calls) {
      totalCalls++
      toolCalls.set(call.name, (toolCalls.get(call.name) ?? 0) + 1)
      if (!toolSessions.has(call.name)) toolSessions.set(call.name, new Set())
      toolSessions.get(call.name)!.add(session)

      if (call.name.startsWith(MCP_PREFIX)) {
        mcpCalls++
        mcpByTool.set(call.name, (mcpByTool.get(call.name) ?? 0) + 1)
        if (!mcpByToolSessions.has(call.name)) mcpByToolSessions.set(call.name, new Set())
        mcpByToolSessions.get(call.name)!.add(session)
      }

      if (call.name === 'Bash') {
        bashCalls++
        bashBySession.set(session, (bashBySession.get(session) ?? 0) + 1)
        for (const intent of classifyBashCall(call.text).intents) {
          intentCalls.set(intent, (intentCalls.get(intent) ?? 0) + 1)
        }
      }
    }

    // One entry is one job, so the entry boundary IS the sequence boundary — no
    // pair may bridge two jobs, however close together they ran.
    const labels = calls.map(sequenceLabelOf)
    for (let i = 1; i < labels.length; i++) {
      const key = `${labels[i - 1]}\t${labels[i]}`
      bigramCounts.set(key, (bigramCounts.get(key) ?? 0) + 1)
      totalPairs++
      if (SURVEY_LABELS.has(labels[i - 1]) && SURVEY_LABELS.has(labels[i])) surveyPairs++
    }

    for (const call of calls.slice(0, BOOTSTRAP_CALLS)) {
      for (const file of fileNamesIn(call.text)) {
        bootstrapReads.set(file, (bootstrapReads.get(file) ?? 0) + 1)
        if (!bootstrapSessions.has(file)) bootstrapSessions.set(file, new Set())
        bootstrapSessions.get(file)!.add(session)
      }
    }
  }

  const bigrams: Bigram[] = [...bigramCounts.entries()]
    .map(([key, count]) => {
      const [from, to] = key.split('\t')
      return { from, to, count, share: shareOf(count, totalPairs) }
    })
    .sort((a, b) => b.count - a.count || a.from.localeCompare(b.from))

  const bootstrap: BootstrapFile[] = [...bootstrapReads.entries()]
    .map(([file, reads]) => ({ file, reads, sessions: bootstrapSessions.get(file)?.size ?? 0 }))
    .sort((a, b) => b.reads - a.reads || a.file.localeCompare(b.file))

  const bashPerSession = [...bashBySession.values()]
  const heaviest = [...bashPerSession].sort((a, b) => b - a).slice(0, HEAVY_SESSIONS)

  return {
    byTool: frequencyRows(toolCalls, toolSessions, totalCalls),
    bashIntents: [...intentCalls.entries()]
      .map(([intent, calls]) => ({ intent, calls, share: shareOf(calls, bashCalls) }))
      .sort((a, b) => b.calls - a.calls || a.intent.localeCompare(b.intent)),
    bigrams,
    surveyLoopShare: shareOf(surveyPairs, totalPairs),
    perSession: {
      // `bashSessions`, not `sessions`: this map only gets a key when a session
      // made a Bash call, while `byTool[].sessions` counts every session. Two
      // columns called "sessions" meaning different things is a trap that widens
      // as soon as the MCP tools start replacing Bash.
      bashSessions: bashBySession.size,
      medianBashCalls: median(bashPerSession),
      maxBashCalls: bashPerSession.length ? Math.max(...bashPerSession) : 0,
      top10Share: shareOf(
        heaviest.reduce((sum, n) => sum + n, 0),
        bashCalls,
      ),
    },
    bootstrap,
    mcpAdoption: {
      mcpCalls,
      totalCalls,
      share: shareOf(mcpCalls, totalCalls),
      byTool: frequencyRows(mcpByTool, mcpByToolSessions, totalCalls),
    },
    coverage: {
      entries: entries.length,
      jobs: jobIds.size,
      firstTs,
      lastTs,
      truncatedEntries,
    },
  }
}

// ── Backfill ─────────────────────────────────────────────────────────────────

export interface IngestFromTranscriptsOptions {
  /** Cap on JOBS examined, newest first. */
  limit?: number
}

export interface IngestFromTranscriptsResult {
  /** Entries written (or, for the read-only walk, built). */
  ingested: number
  /** Already in the log, or no `sessionId` to join on, or nothing new to read. */
  skipped: number
  /**
   * Had a `sessionId` but no readable source. Counted separately on purpose: this
   * is the pruned-transcript case AND the "wrong adapter" case, and folding it into
   * `skipped` is what let 82 agent-SDK jobs disappear without a sound.
   */
  noTranscript: number
}

/**
 * Job records on disk, newest first.
 *
 * Deliberately NOT `listJobs()` from `jobQueue`: importing that module runs
 * `startRecoverPoller()` at load time, which both keeps the event loop alive (a
 * CLI that never exits) and starts recovering jobs from a process whose only job
 * is to count things. Same reasoning as the import note at the top of
 * `mcp/tools/tasks.ts`.
 */
async function readJobRecords(limit?: number): Promise<JobRecord[]> {
  const dir = joinPath(registryHome(), 'jobs')
  const names = (await safeReadDir(dir)).filter((e) => e.isFile() && e.name.endsWith('.json'))
  const jobs: JobRecord[] = []
  for (const entry of names) {
    const file = resolvePathUnder(dir, entry.name)
    if (!file) continue
    try {
      const job = JSON.parse(await readTextFile(file)) as JobRecord
      if (job?.id) jobs.push(job)
    } catch {
      // A half-written or hand-edited job file must not abort the backfill.
    }
  }
  jobs.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  return limit && limit > 0 ? jobs.slice(0, limit) : jobs
}

/**
 * Which adapter a finished job's session belongs to.
 *
 * `metadata.providerId` does NOT exist — measured: 0 of 1.457 job files carry it.
 * The provider lives on the `connection`, resolved from `runnerId` at run time,
 * which is why `jobQueue` has to pass `connection.providerId` into
 * `captureJobToolCalls` rather than reading it off the record.
 *
 * Two lookups, in this order, because neither alone is enough. Measured 2026-10-01
 * over 1.469 job files, 82 of which have an `agent-sdk-sessions` file:
 *   1. `runnerId` → runner → connection. Gives the real provider id, and covers 49
 *      of the 82 — but the other 33 ran on runners that have since been deleted,
 *      so the connection lookup yields nothing at all for them.
 *   2. Probe `agent-sdk-sessions/<sessionId>.json`. Ground truth on disk, the only
 *      thing left once the runner is gone, and it rescues all 33.
 *
 * Importing the runner registry is safe here (unlike `jobQueue`): it only registers
 * providers in memory, starts no poller, and lets the process exit.
 */
async function resolveJobProvider(job: JobRecord, sessionId: string): Promise<string> {
  try {
    const { getRunner } = await import('../../runner/business/registry.js')
    const { getConnection } = await import('../../runner/business/connections.js')
    const runner = job.runnerId ? getRunner(job.runnerId) : null
    const connection = runner?.connectionId ? getConnection(runner.connectionId) : null
    if (connection?.providerId) return connection.providerId
  } catch {
    // Unreadable runners.json / connections.json — fall through to the disk probe.
  }

  const { agentSdkSessionPath } = await import('../../runner/business/agentSdkToolCalls.js')
  const file = agentSdkSessionPath(sessionId)
  if (file && (await statSafe(file)).exists) return 'agent-sdk-session'
  return 'claude-code-cli'
}

/**
 * When the job's work actually happened.
 *
 * Shared by both consumers of the walk on purpose: the read-only path had this
 * logic and the writing path did not, so the same backfill reported a span of
 * 2026-08-16…2026-10-01 through `--from-transcripts` and 0,35 seconds through
 * `--ingest`. One helper, one answer.
 */
function jobStampMs(job: JobRecord): number {
  const stamp = job.finishedAt || job.startedAt || job.createdAt
  const parsed = stamp ? Date.parse(stamp) : Number.NaN
  return Number.isFinite(parsed) ? parsed : Date.now()
}

/**
 * Walk every job that has a session and build one `tool-call` entry each, oldest
 * job first, carrying a per-session cursor for the length of the walk.
 *
 * The cursor is what keeps a resumed session honest. Both sources replay history —
 * a CLI transcript grows, an agent-SDK session file is rewritten whole — so reading
 * each job from zero would count the first job's calls again in every later job on
 * that session. 221 sessions have more than one job and the heaviest has 28, so the
 * error grows as O(n²). Oldest-first + cursor gives each job exactly what it added.
 *
 * `onEntry` decides what happens to each payload, which is the whole reason this is
 * separate from `ingestFromTranscripts`: `--from-transcripts` alone aggregates
 * without writing anything.
 */
async function walkTranscripts(
  opts: IngestFromTranscriptsOptions,
  known: Set<string>,
  onEntry: (payload: ToolCallEntryPayload, job: JobRecord) => void | Promise<void>,
): Promise<IngestFromTranscriptsResult> {
  const { buildJobToolCallEntry } = await import('../../runner/business/toolCallCapture.js')

  const jobs = await readJobRecords(opts.limit)
  // `readJobRecords` is newest-first so `limit` means "the most recent N"; the
  // cursor below needs the opposite order.
  jobs.reverse()

  // Keyed by session AND source: the number means lines for a CLI transcript but
  // calls for an SDK session. No job pairs the two today, but one session id
  // reaching both adapters would silently mix the two units.
  const cursorBySession = new Map<string, number>()
  let ingested = 0
  let skipped = 0
  let noTranscript = 0

  for (const job of jobs) {
    const sessionId = job.sessionId
    if (!sessionId) {
      skipped++
      continue
    }

    const providerId = await resolveJobProvider(job, sessionId)
    const cursorKey = `${sessionId}\t${providerId === 'claude-code-cli' ? 'cli' : 'sdk'}`
    const fromCursor = cursorBySession.get(cursorKey) ?? 0
    const built = await buildJobToolCallEntry(job, sessionId, providerId, fromCursor)

    if (built.status === 'no-source') {
      noTranscript++
      continue
    }
    // Advance even for a job already in the log: skipping the read would hand its
    // calls to the next job on the same session and count them twice.
    cursorBySession.set(cursorKey, built.nextCursor)

    if (built.status === 'empty' || known.has(job.id)) {
      skipped++
      continue
    }

    await onEntry(built.payload, job)
    known.add(job.id)
    ingested++
  }

  return { ingested, skipped, noTranscript }
}

/**
 * Backfill the log from the transcripts still on disk.
 *
 * This lives in business, not in the CLI, for two reasons: the script is meant to
 * be a thin front end, and this is the SECOND idempotency path — independent of
 * the ledger cursor that guards the runtime path. Manual backfill has no ledger
 * cursor, so it dedupes on `jobId` against what the log already holds; running it
 * twice over the same transcripts must ingest nothing the second time.
 */
export async function ingestFromTranscripts(
  opts: IngestFromTranscriptsOptions = {},
): Promise<IngestFromTranscriptsResult> {
  if (!isLogTypeEnabled('tool-call')) return { ingested: 0, skipped: 0, noTranscript: 0 }

  // Full dedupe window on purpose: `opts.limit` caps JOBS, while log entries are
  // ordered by ingest time and jobs by `createdAt`. Sharing one cap could leave a
  // job's own entry outside the window and ingest it a second time.
  const existing = await readToolCallEntries({})
  const known = new Set(existing.map((e) => e.jobId))

  const { appendToolCallLog } = await import('../../../backend/log/store.js')
  // `ts` from the job, not the clock — see `jobStampMs`.
  return walkTranscripts(opts, known, (payload, job) =>
    appendToolCallLog({ ...payload, ts: jobStampMs(job) }),
  )
}

/**
 * Same walk, but nothing is written: entries are built in memory so the stats can
 * be read straight off the transcripts.
 *
 * This is the only way to see the 2,9% of jobs whose transcripts still exist when
 * the `tool-call` log type has never been switched on — so it deliberately does NOT
 * check `isLogTypeEnabled`, because it never touches the log.
 *
 * `ts` comes from the job's own timestamps rather than the clock, so `--from` /
 * `--to` filter by when the work happened, not by when the scan ran.
 */
export async function collectFromTranscripts(
  opts: IngestFromTranscriptsOptions = {},
): Promise<{ entries: ToolCallLogEntry[]; summary: IngestFromTranscriptsResult }> {
  const entries: ToolCallLogEntry[] = []
  const summary = await walkTranscripts(opts, new Set(), (payload, job) => {
    const ts = jobStampMs(job)
    entries.push({
      type: 'tool-call',
      ts,
      iso: new Date(ts).toISOString(),
      level: 'info',
      traceId: '',
      ...payload,
    })
  })
  return { entries, summary }
}
