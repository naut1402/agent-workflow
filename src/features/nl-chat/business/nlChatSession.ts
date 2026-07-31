import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { registryHome } from '../../../core/registry.js'
import { submitJob, sendTaskFeedback, listJobs, closeTaskSession } from '../../runner/business/index.js'
import type { JobRecord, MutationResult } from '../../runner/business/index.js'
import { buildTurnPrompt } from './buildTurnPrompt.js'
import { parseBuilderOutput, type BuilderTurn, type NlChatEntityType } from './parseBuilderOutput.js'

export type { NlChatEntityType } from './parseBuilderOutput.js'

const CHAT_SESSION_PREFIX = 'nlchat-'

/** All `taskId`-shaped keys minted by this module use this prefix. */
export function isNlChatSessionId(id: unknown): id is string {
  return typeof id === 'string' && id.startsWith(CHAT_SESSION_PREFIX)
}

function mintChatSessionId(): string {
  return `${CHAT_SESSION_PREFIX}${crypto.randomBytes(4).toString('hex')}`
}

/** Scratch workspace for a chat session — no real project file is ever touched. */
function scratchWorkspace(chatSessionId: string): string {
  return path.join(registryHome(), 'nlchat-scratch', chatSessionId)
}

/** Jobs tagged with this chat session, oldest first. */
function findChatJobs(chatSessionId: string): JobRecord[] {
  return listJobs(200)
    .filter((j) => j.metadata?.taskId === chatSessionId)
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
}

function entityTypeOf(job: JobRecord | undefined): NlChatEntityType | null {
  const t = job?.metadata?.entityType
  return t === 'task' || t === 'pipeline' || t === 'agent' ? t : null
}

export interface StartNlChatSessionInput {
  projectId: string
  /** Omitted for the free-form chat surface — the agent infers the entity itself. */
  entityType?: NlChatEntityType | null
  message: string
  runnerId?: string
  /** Extra system context appended to turn 1 only (e.g. valid catalog agent refs for a pipeline draft). */
  extraContext?: string
  /**
   * Resolved `.dev-team-agent/` root — required so `resolveAgent()` can find
   * `custom-agents/nl-chat-builder.md` under THIS root (not the scratch
   * workspace, which is what `devTeamRoot` would otherwise default to).
   */
  devTeamRoot: string
}

export interface NlChatSessionStarted {
  chatSessionId: string
  job: JobRecord
}

/**
 * Start a new NL chat session: mint a `nlchat-<hex>` id (shaped like a real
 * task id, per TASK_ID_PATTERN) used purely as the lookup key for
 * `submitJob`/`sendTaskFeedback` — it is never written to `tasks/<id>/` or
 * `.dev-state/<id>.json`. See design.md §4.2.
 */
export function startNlChatSession(input: StartNlChatSessionInput): NlChatSessionStarted {
  const chatSessionId = mintChatSessionId()
  const workspace = scratchWorkspace(chatSessionId)
  fs.mkdirSync(workspace, { recursive: true })

  const prompt = buildTurnPrompt({
    entityType: input.entityType,
    turnIndex: 1,
    message: input.message,
    extraContext: input.extraContext,
  })

  const job = submitJob({
    agentRef: 'dashboard:nl-chat-builder',
    workspace,
    userPrompt: prompt,
    runnerId: input.runnerId,
    sessionMode: 'new',
    metadata: {
      taskId: chatSessionId,
      projectId: input.projectId,
      projectRoot: path.dirname(input.devTeamRoot),
      devTeamRoot: input.devTeamRoot,
      isNlChat: true,
      ...(input.entityType ? { entityType: input.entityType } : {}),
    },
  })

  return { chatSessionId, job }
}

/**
 * Continue an existing chat session with a follow-up message. Does not
 * re-implement any resume logic — delegates entirely to `sendTaskFeedback`
 * (F0011), which resumes the CLI session recorded in the chat session's
 * ledger entry.
 */
export function continueNlChatSession(
  chatSessionId: string,
  projectId: string,
  message: string,
): MutationResult<{ job: JobRecord }> {
  const jobs = findChatJobs(chatSessionId)
  // A session is known by having at least one tagged job — `entityType` may be
  // absent (auto mode), so it can no longer double as the existence check.
  if (jobs.length === 0) return { ok: false, status: 404, error: 'unknown chat session' }
  const entityType = entityTypeOf(jobs[jobs.length - 1])

  const prompt = buildTurnPrompt({
    entityType,
    turnIndex: jobs.length + 1,
    message,
  })
  return sendTaskFeedback(chatSessionId, projectId, prompt)
}

export type NlChatTurnResult =
  | { status: 'pending' }
  | { status: 'error'; error: string }
  | ({ status: 'ready' } & BuilderTurn)

/** Latest turn's outcome for a chat session: pending, error, or a parsed builder turn. */
export function getNlChatTurn(chatSessionId: string): NlChatTurnResult {
  const jobs = findChatJobs(chatSessionId)
  const last = jobs[jobs.length - 1]
  if (!last) return { status: 'error', error: 'unknown chat session' }
  if (last.status === 'queued' || last.status === 'running') return { status: 'pending' }
  if (last.status === 'failed' || last.status === 'cancelled') {
    return { status: 'error', error: last.error || `job ${last.status}` }
  }

  return { status: 'ready', ...parseBuilderOutput(agentStdoutOf(last)) }
}

const RESPONSE_HEADER = '=== Phản hồi của runner (stdout/stderr) ==='
const RESULT_HEADER = '=== Kết quả ==='

/**
 * The agent's own answer for this turn. `job.stdout` is the CLI's raw stdout,
 * persisted for NL chat jobs precisely for this. The log file is only a
 * fallback (jobs from before that was persisted): it also holds the payload +
 * full prompt, so the framing must be stripped — otherwise the chat surface
 * echoes the whole runner log back at the user.
 */
function agentStdoutOf(job: JobRecord): string {
  if (typeof job.stdout === 'string' && job.stdout.trim()) return job.stdout

  let log = ''
  try {
    log = job.logPath ? fs.readFileSync(job.logPath, 'utf8') : ''
  } catch {
    return ''
  }

  const start = log.indexOf(RESPONSE_HEADER)
  if (start < 0) return ''
  let body = log.slice(start + RESPONSE_HEADER.length)
  const end = body.indexOf(RESULT_HEADER)
  if (end >= 0) body = body.slice(0, end)
  return body
    .split('\n')
    .filter((line) => !line.startsWith('[runner] '))
    .join('\n')
    .trim()
}

/** Close the session's ledger entry and best-effort remove its scratch workspace. */
export function cancelNlChatSession(chatSessionId: string, projectId: string): void {
  closeTaskSession(projectId, chatSessionId)
  const jobs = findChatJobs(chatSessionId)
  const workspace = jobs[0]?.workspace
  if (workspace) {
    try {
      fs.rmSync(workspace, { recursive: true, force: true })
    } catch {
      /* best-effort cleanup only */
    }
  }
}
