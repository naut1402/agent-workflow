import { joinPath, mkdirSync, readTextFileSync, renameSync, resolvePath, writeTextFileSync } from '../../../core/lib/fileHelper.js'
import crypto from 'node:crypto'
import os from 'node:os'
import { registryHome } from '../../../core/registry.js'

export type SessionPolicy = 'single' | 'per-step' | 'per-runner'
export type SessionEntryStatus = 'open' | 'closed' | 'stale' | 'archived'
export type SessionMode = 'new' | 'resume' | 'none'

export interface SessionEntry {
  sessionId: string | null
  providerId: string
  runnerId: string
  connectionId: string
  workspace: string
  host: string
  model?: string
  stepIds: string[]
  status: SessionEntryStatus
  createdAt: string
  lastUsedAt: string
  staleReason?: string
}

export interface TaskSessionLedger {
  version: 1
  taskId: string
  sessionPolicy: SessionPolicy
  sessions: SessionEntry[]
}

export interface ResolveSessionContext {
  projectId: string
  taskId: string
  sessionMode?: SessionMode
  sessionId?: string
  providerId: string
  runnerId: string
  connectionId: string
  workspace: string
  host?: string
  model?: string
  stepId?: string
}

export interface ResolvedSessionPlan {
  sessionMode: SessionMode
  sessionId?: string
  resumeSessionId?: string
  staleReason?: string
}

function sessionsDir(projectId: string): string {
  return joinPath(registryHome(), 'sessions', projectId)
}

function ledgerFile(projectId: string, taskId: string): string {
  return joinPath(sessionsDir(projectId), `${taskId}.json`)
}

function emptyLedger(taskId: string): TaskSessionLedger {
  return { version: 1, taskId, sessionPolicy: 'single', sessions: [] }
}

export function loadTaskSessionLedger(projectId: string, taskId: string): TaskSessionLedger {
  if (!projectId || !taskId) return emptyLedger(taskId)
  try {
    const raw = readTextFileSync(ledgerFile(projectId, taskId))
    const data = JSON.parse(raw) as TaskSessionLedger
    if (!data || data.version !== 1 || !Array.isArray(data.sessions)) return emptyLedger(taskId)
    return {
      version: 1,
      taskId: data.taskId || taskId,
      sessionPolicy: data.sessionPolicy || 'single',
      sessions: data.sessions,
    }
  } catch {
    return emptyLedger(taskId)
  }
}

export function saveTaskSessionLedger(projectId: string, ledger: TaskSessionLedger): void {
  const dir = sessionsDir(projectId)
  mkdirSync(dir, { recursive: true })
  const file = ledgerFile(projectId, ledger.taskId)
  const tmp = `${file}.tmp`
  writeTextFileSync(tmp, JSON.stringify(ledger, null, 2))
  renameSync(tmp, file)
}

function findOpenEntry(ledger: TaskSessionLedger): SessionEntry | null {
  for (let i = ledger.sessions.length - 1; i >= 0; i--) {
    const s = ledger.sessions[i]
    if (s.status === 'open') return s
  }
  return null
}

export interface SessionInvalidReason {
  invalid: boolean
  reason?: string
}

/** Pre-flight: can we resume this ledger entry in the current context? */
export function isSessionEntryValid(
  entry: SessionEntry,
  ctx: Pick<ResolveSessionContext, 'host' | 'workspace' | 'providerId' | 'connectionId'>,
): SessionInvalidReason {
  const host = ctx.host || os.hostname()
  if (entry.host !== host) {
    return { invalid: true, reason: 'host changed' }
  }
  if (entry.status === 'archived' || entry.status === 'stale') {
    return { invalid: true, reason: `session ${entry.status}` }
  }
  if (entry.providerId !== ctx.providerId) {
    return { invalid: true, reason: 'provider changed' }
  }
  if (entry.connectionId !== ctx.connectionId) {
    return { invalid: true, reason: 'connection changed' }
  }
  if (resolvePath(entry.workspace) !== resolvePath(ctx.workspace)) {
    return { invalid: true, reason: 'workspace changed' }
  }
  if (!entry.sessionId) {
    return { invalid: true, reason: 'session id not captured yet' }
  }
  return { invalid: false }
}

/**
 * Decide session flags for a job from explicit sessionMode + ledger (policy
 * `single` by default). Invalid resume conditions force a fresh session.
 *
 * When `stepId` is set and an open entry exists for a *different* step only
 * (per-step isolation): force `new` so pipeline steps do not share a Cursor /
 * Claude session that the chat UI cannot resolve for the current step.
 */
export function resolveSessionPlan(ctx: ResolveSessionContext): ResolvedSessionPlan {
  const mode = ctx.sessionMode ?? 'none'
  if (mode === 'none') return { sessionMode: 'none' }

  const ledger = loadTaskSessionLedger(ctx.projectId, ctx.taskId)
  const open = findOpenEntry(ledger)

  if (mode === 'new') {
    return { sessionMode: 'new', sessionId: ctx.sessionId }
  }

  // Prefer an open entry that already lists this step (same-step resume)
  // BEFORE applying per-step isolation against the newest open entry.
  let candidate = open
  if (ctx.stepId) {
    const byStep = [...ledger.sessions]
      .reverse()
      .find((s) => s.status === 'open' && s.stepIds?.includes(ctx.stepId!) && s.sessionId)
    if (byStep) candidate = byStep
  }

  if (
    ctx.stepId &&
    candidate &&
    candidate.stepIds?.length &&
    !candidate.stepIds.includes(ctx.stepId) &&
    ledger.sessionPolicy === 'per-step'
  ) {
    return { sessionMode: 'new', staleReason: 'per-step: new step' }
  }

  const candidateId = ctx.sessionId || candidate?.sessionId || undefined
  if (candidate && candidateId) {
    const check = isSessionEntryValid(candidate, ctx)
    if (!check.invalid) {
      return { sessionMode: 'resume', resumeSessionId: candidateId }
    }
    return { sessionMode: 'new', staleReason: check.reason }
  }

  if (candidateId) {
    return { sessionMode: 'resume', resumeSessionId: candidateId }
  }

  return { sessionMode: 'new' }
}

export interface RecordSessionInput {
  projectId: string
  taskId: string
  sessionId: string | null
  providerId: string
  runnerId: string
  connectionId: string
  workspace: string
  host?: string
  model?: string
  stepId?: string
  forceNew?: boolean
  staleReason?: string
}

/** Upsert ledger after a job starts or captures a session id. */
export function recordSessionUsage(input: RecordSessionInput): void {
  const { projectId, taskId } = input
  if (!projectId || !taskId) return

  const ledger = loadTaskSessionLedger(projectId, taskId)
  const now = new Date().toISOString()
  const host = input.host || os.hostname()

  if (input.forceNew || input.staleReason) {
    for (const s of ledger.sessions) {
      if (s.status === 'open') {
        s.status = 'stale'
        s.staleReason = input.staleReason || 'superseded'
        s.lastUsedAt = now
      }
    }
  }

  let open = findOpenEntry(ledger)
  if (!open || input.forceNew) {
    open = {
      sessionId: input.sessionId,
      providerId: input.providerId,
      runnerId: input.runnerId,
      connectionId: input.connectionId,
      workspace: resolvePath(input.workspace),
      host,
      model: input.model,
      stepIds: input.stepId ? [input.stepId] : [],
      status: 'open',
      createdAt: now,
      lastUsedAt: now,
    }
    ledger.sessions.push(open)
  } else {
    open.sessionId = input.sessionId ?? open.sessionId
    open.lastUsedAt = now
    if (input.stepId && !open.stepIds.includes(input.stepId)) {
      open.stepIds.push(input.stepId)
    }
  }

  saveTaskSessionLedger(projectId, ledger)
}

export function closeTaskSession(projectId: string, taskId: string): void {
  const ledger = loadTaskSessionLedger(projectId, taskId)
  const now = new Date().toISOString()
  let changed = false
  for (const s of ledger.sessions) {
    if (s.status === 'open') {
      s.status = 'closed'
      s.lastUsedAt = now
      changed = true
    }
  }
  if (changed) saveTaskSessionLedger(projectId, ledger)
}

// ── CLI session capture helpers ────────────────────────────────────────────

export type SessionCaptureMode = 'preset-uuid' | 'parse-json' | 'none'

export interface CursorJsonOutput {
  session_id?: string
  result?: string
}

function cursorFieldsFrom(parsed: Record<string, unknown>): CursorJsonOutput {
  return {
    session_id: typeof parsed.session_id === 'string' ? parsed.session_id : undefined,
    result: typeof parsed.result === 'string' ? parsed.result : undefined,
  }
}

/** Parse cursor-agent JSON stdout; tolerates leading/trailing whitespace/noise. */
export function parseCursorJsonOutput(stdout: string): CursorJsonOutput {
  const trimmed = stdout.trim()
  if (!trimmed) return {}
  try {
    return cursorFieldsFrom(JSON.parse(trimmed) as Record<string, unknown>)
  } catch {
    // Defensive: tolerate a leading stderr line (or similar) before the JSON object.
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start < 0 || end <= start) return {}
    try {
      return cursorFieldsFrom(JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>)
    } catch {
      return {}
    }
  }
}

export interface CursorJsonInvocationInput {
  flags: string[]
  prompt: string
  resumeSessionId?: string
}

export interface CursorJsonInvocation {
  args: string[]
  stdinInput: string
}

/**
 * Build cursor headless invocation with JSON output for session capture.
 *
 * The prompt is delivered on STDIN, never as an argv element — same Windows
 * `shell: true` argv-splitting bug that forced Claude onto stdin. Cursor CLI
 * accepts a piped prompt with `-p` / `--print` (print mode is inferred when
 * stdin is not a TTY).
 */
export function buildCursorJsonInvocation(input: CursorJsonInvocationInput): CursorJsonInvocation {
  const base = Array.isArray(input.flags) ? [...input.flags] : []
  if (!base.includes('-p')) base.push('-p')
  if (!base.some((f) => f === '--output-format' || f.startsWith('--output-format='))) {
    base.push('--output-format', 'json')
  }
  const hasTrust =
    base.includes('--trust') ||
    base.includes('--yolo') ||
    base.includes('-f') ||
    base.includes('--force')
  if (!hasTrust) base.push('--trust')
  if (input.resumeSessionId) base.push('--resume', input.resumeSessionId)
  return { args: base, stdinInput: input.prompt }
}

/** Flag-only argv for cursor JSON mode (prompt is on stdin — see buildCursorJsonInvocation). */
export function buildCursorJsonArgs(
  flags: string[],
  prompt: string,
  resumeSessionId?: string,
): string[] {
  return buildCursorJsonInvocation({ flags, prompt, resumeSessionId }).args
}

/** Mint a v4 UUID for Claude `--session-id`. */
export function mintSessionId(): string {
  return crypto.randomUUID()
}

export interface SessionPrepareInput {
  capture: SessionCaptureMode
  sessionId?: string
  resumeSessionId?: string
}

export interface SessionPrepareResult {
  sessionId?: string
  resumeSessionId?: string
  /** Pre-assigned id for preset-uuid capture before spawn. */
  presetSessionId?: string
}

/**
 * Map ExecuteRequest session fields + capture mode into provider invocation
 * fields. preset-uuid generates an id when starting fresh.
 */
export function prepareSessionInvocation(input: SessionPrepareInput): SessionPrepareResult {
  if (input.capture === 'none') {
    return {
      sessionId: input.sessionId,
      resumeSessionId: input.resumeSessionId,
    }
  }

  if (input.resumeSessionId || (input.sessionId && input.capture !== 'preset-uuid')) {
    return {
      resumeSessionId: input.resumeSessionId || input.sessionId,
    }
  }

  if (input.capture === 'preset-uuid') {
    const preset = input.sessionId || mintSessionId()
    return { sessionId: preset, presetSessionId: preset }
  }

  // parse-json: session id arrives after CLI exits — no preset.
  return {}
}
