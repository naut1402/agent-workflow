import { joinPath, mkdirSync, readTextFileSync, resolvePath, writeTextFileAtomicSync } from '../../../backend/lib/fileHelper.js'
import crypto from 'node:crypto'
import os from 'node:os'
import { registryHome } from '../../../backend/registry.js'
import { ORCHESTRATOR_STEP_ID } from '../../../shared/lib/orchestrator.js'

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
  /** Cursor for Claude transcript usage capture across resume jobs. */
  usageCursor?: UsageCursor
  /**
   * Cursor for tool-call ingest. Deliberately a SEPARATE key from `usageCursor`:
   * sharing `mainLines` would let whichever ingest ran first consume the lines the
   * other one still has to read, which happens for real whenever one of the two
   * log types is on and the other is off.
   */
  toolCallCursor?: ToolCallCursor
}

export interface UsageCursor {
  mainLines: number
  subagentFiles: string[]
}

export interface ToolCallCursor {
  mainLines: number
}

export interface TaskSessionLedger {
  version: 1
  taskId: string
  /**
   * @deprecated Không còn nhánh logic nào đọc field này. Cách ly phiên theo
   * `stepId` (mỗi node một entry `open`) đã là mặc định, nên `'per-step'` không
   * còn ý nghĩa, và `'per-runner'` chưa bao giờ có nhánh xử lý. Giữ lại để đọc
   * và ghi lại nguyên vẹn các file ledger cũ.
   */
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

/** Lý do stale cho entry lẫn phiên điều phối với phiên của một step. */
export const MIXED_SESSION_REASON = 'mixed-session'

/**
 * Migration nhẹ lúc đọc: entry vừa mang `__orchestrator__` vừa mang step id
 * khác là tàn dư của bug "một ô session cho cả task" — phiên CLI đó đã lẫn
 * context của hai node, resume vào nó là tiếp tục làm bẩn phiên điều phối.
 *
 * Chỉ sửa TRONG BỘ NHỚ: `loadTaskSessionLedger` là hàm đọc thuần dùng ở rất
 * nhiều nơi (kể cả `getUsageCursor`), ghi đĩa từ đây là tác dụng phụ ngoài hợp
 * đồng. Trạng thái đã làm sạch được bền hoá ở lần `recordSessionUsage` kế tiếp.
 */
function sanitizeLedger(ledger: TaskSessionLedger): TaskSessionLedger {
  for (const s of ledger.sessions) {
    if (!s || s.status !== 'open') continue
    if (!s.stepIds?.includes(ORCHESTRATOR_STEP_ID)) continue
    if (s.stepIds.length <= 1) continue
    s.status = 'stale'
    s.staleReason = MIXED_SESSION_REASON
  }
  return ledger
}

export function loadTaskSessionLedger(projectId: string, taskId: string): TaskSessionLedger {
  if (!projectId || !taskId) return emptyLedger(taskId)
  try {
    const raw = readTextFileSync(ledgerFile(projectId, taskId))
    const data = JSON.parse(raw) as TaskSessionLedger
    if (!data || data.version !== 1 || !Array.isArray(data.sessions)) return emptyLedger(taskId)
    return sanitizeLedger({
      version: 1,
      taskId: data.taskId || taskId,
      sessionPolicy: data.sessionPolicy || 'single',
      sessions: data.sessions,
    })
  } catch {
    return emptyLedger(taskId)
  }
}

export function saveTaskSessionLedger(projectId: string, ledger: TaskSessionLedger): void {
  const dir = sessionsDir(projectId)
  mkdirSync(dir, { recursive: true })
  writeTextFileAtomicSync(ledgerFile(projectId, ledger.taskId), JSON.stringify(ledger, null, 2))
}

/**
 * Đường ĐỌC — permissive. Có `stepId` thì chỉ nhận entry của đúng node đó;
 * không có thì giữ nguyên hành vi cũ (entry `open` mới nhất), vì chat cấp task,
 * nl-chat và job ad-hoc vẫn phải nối được phiên vừa chạy.
 */
function findOpenEntry(ledger: TaskSessionLedger, stepId?: string): SessionEntry | null {
  for (let i = ledger.sessions.length - 1; i >= 0; i--) {
    const s = ledger.sessions[i]
    if (!s || s.status !== 'open') continue
    if (stepId && !s.stepIds?.includes(stepId)) continue
    return s
  }
  return null
}

/**
 * Đường GHI — strict. Chỉ trả entry mà caller thật sự SỞ HỮU, vì đây là entry
 * sắp bị ghi đè `sessionId`. Mượn entry `open` của node khác ở đây chính là
 * chỗ sinh ra entry lai (phiên điều phối bị phiên của step chiếm chỗ).
 */
function findOwnedOpenEntry(
  ledger: TaskSessionLedger,
  stepId?: string,
  sessionId?: string | null,
): SessionEntry | null {
  for (let i = ledger.sessions.length - 1; i >= 0; i--) {
    const s = ledger.sessions[i]
    if (!s || s.status !== 'open') continue
    if (stepId) {
      if (s.stepIds?.includes(stepId)) return s
      continue
    }
    // Không có stepId: chỉ nhận entry chưa thuộc node nào, hoặc entry đang mang
    // đúng session id này (ghi lại chính nó, không phải chiếm chỗ của ai).
    if (!s.stepIds?.length || (sessionId && s.sessionId === sessionId)) return s
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
 * Decide session flags for a job from explicit sessionMode + ledger. Invalid
 * resume conditions force a fresh session.
 *
 * Mỗi node (nút điều phối + từng step) giữ một entry `open` riêng: `stepId` có
 * nghĩa là "chỉ phiên của node này", còn không có `stepId` thì giữ nguyên hành
 * vi cũ — nối tiếp entry `open` mới nhất. Đây là đường ĐỌC, cố ý permissive.
 */
export function resolveSessionPlan(ctx: ResolveSessionContext): ResolvedSessionPlan {
  const mode = ctx.sessionMode ?? 'none'
  if (mode === 'none') return { sessionMode: 'none' }

  if (mode === 'new') {
    return { sessionMode: 'new', sessionId: ctx.sessionId }
  }

  const ledger = loadTaskSessionLedger(ctx.projectId, ctx.taskId)
  const candidate = findOpenEntry(ledger, ctx.stepId)
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

  // Node đã hỏi xin phiên của CHÍNH NÓ và không có — nói rõ trong `staleReason`
  // để log của lượt chạy phân biệt được với "task này chưa có phiên nào".
  return ctx.stepId
    ? { sessionMode: 'new', staleReason: 'no open session for this node' }
    : { sessionMode: 'new' }
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

  // Mở phiên mới chỉ thay phiên CỦA CHÍNH NODE NÀY. Trước đây vòng này quét
  // sạch mọi entry `open`, nên một step respawn là đóng luôn phiên điều phối.
  if (input.forceNew || input.staleReason) {
    for (const s of ledger.sessions) {
      if (s.status !== 'open') continue
      // Đối xứng với `findOwnedOpenEntry`: có `stepId` thì chỉ chạm entry CÙNG
      // node; KHÔNG có `stepId` thì chỉ được chạm entry "vô chủ". Bỏ nhánh
      // `else` là mở lại đúng đường quét chéo đã sinh ra bug gốc — một job
      // không mang `stepId` sẽ đóng luôn phiên của nút điều phối.
      if (input.stepId) {
        if (!s.stepIds?.includes(input.stepId)) continue
      } else if (s.stepIds?.length) continue
      s.status = 'stale'
      s.staleReason = input.staleReason || 'superseded'
      s.lastUsedAt = now
    }
  }

  // Đường GHI: không tìm thấy entry của mình thì TẠO MỚI, tuyệt đối không mượn
  // entry đang mở của node khác — đó là chỗ `sessionId` của nút điều phối bị
  // một job step ghi đè, và từ lượt sau cha resume thẳng vào phiên của con.
  let own = findOwnedOpenEntry(ledger, input.stepId, input.sessionId)
  if (!own || input.forceNew) {
    own = {
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
    ledger.sessions.push(own)
  } else {
    own.sessionId = input.sessionId ?? own.sessionId
    own.lastUsedAt = now
    // Ledger cũ (trước khi có `stepIds`) thiếu field — vẫn phải vá.
    // Không `push` thêm node vào đây: `findOwnedOpenEntry` chỉ trả entry ĐÃ
    // chứa `stepId` (hoặc entry vô chủ khi không có `stepId`), nên entry lai
    // không còn đường hình thành. Giữ lại một nhánh chết ở đúng chỗ vừa sửa
    // bug chỉ làm người đọc sau tưởng nó vẫn chạy được.
    if (!Array.isArray(own.stepIds)) own.stepIds = []
  }

  saveTaskSessionLedger(projectId, ledger)
}

export function closeTaskSession(projectId: string, taskId: string, opts?: { stepId?: string }): void {
  const ledger = loadTaskSessionLedger(projectId, taskId)
  const now = new Date().toISOString()
  let changed = false
  for (const s of ledger.sessions) {
    if (s.status !== 'open') continue
    if (opts?.stepId && !s.stepIds?.includes(opts.stepId)) continue
    s.status = 'closed'
    s.lastUsedAt = now
    changed = true
  }
  if (changed) saveTaskSessionLedger(projectId, ledger)
}

/** Read usage cursor for a session id on the task ledger (null if missing). */
export function getUsageCursor(
  projectId: string,
  taskId: string,
  sessionId: string,
): UsageCursor | null {
  if (!projectId || !taskId || !sessionId) return null
  const ledger = loadTaskSessionLedger(projectId, taskId)
  for (let i = ledger.sessions.length - 1; i >= 0; i--) {
    const s = ledger.sessions[i]
    if (s.sessionId === sessionId && s.usageCursor) return { ...s.usageCursor, subagentFiles: [...s.usageCursor.subagentFiles] }
    if (s.sessionId === sessionId) return null
  }
  return null
}

/** Persist usage cursor onto the matching session entry (no-op if not found). */
export function setUsageCursor(
  projectId: string,
  taskId: string,
  sessionId: string,
  cursor: UsageCursor,
): void {
  if (!projectId || !taskId || !sessionId) return
  const ledger = loadTaskSessionLedger(projectId, taskId)
  let changed = false
  for (let i = ledger.sessions.length - 1; i >= 0; i--) {
    const s = ledger.sessions[i]
    if (s.sessionId !== sessionId) continue
    s.usageCursor = {
      mainLines: Math.max(0, cursor.mainLines),
      subagentFiles: [...cursor.subagentFiles],
    }
    s.lastUsedAt = new Date().toISOString()
    changed = true
    break
  }
  if (changed) saveTaskSessionLedger(projectId, ledger)
}

/** Read tool-call cursor for a session id on the task ledger (null if missing). */
export function getToolCallCursor(
  projectId: string,
  taskId: string,
  sessionId: string,
): ToolCallCursor | null {
  if (!projectId || !taskId || !sessionId) return null
  const ledger = loadTaskSessionLedger(projectId, taskId)
  for (let i = ledger.sessions.length - 1; i >= 0; i--) {
    const s = ledger.sessions[i]
    if (s.sessionId !== sessionId) continue
    return s.toolCallCursor ? { ...s.toolCallCursor } : null
  }
  return null
}

/** Persist tool-call cursor onto the matching session entry (no-op if not found). */
export function setToolCallCursor(
  projectId: string,
  taskId: string,
  sessionId: string,
  cursor: ToolCallCursor,
): void {
  if (!projectId || !taskId || !sessionId) return
  const ledger = loadTaskSessionLedger(projectId, taskId)
  let changed = false
  for (let i = ledger.sessions.length - 1; i >= 0; i--) {
    const s = ledger.sessions[i]
    if (s.sessionId !== sessionId) continue
    s.toolCallCursor = { mainLines: Math.max(0, cursor.mainLines) }
    s.lastUsedAt = new Date().toISOString()
    changed = true
    break
  }
  if (changed) saveTaskSessionLedger(projectId, ledger)
}

// ── CLI session capture helpers ────────────────────────────────────────────

export type SessionCaptureMode = 'preset-uuid' | 'parse-json' | 'none'

export interface CursorJsonOutput {
  session_id?: string
  result?: string
  /** Token usage from Cursor `--output-format json` result payload (camelCase). */
  usage?: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
  }
  model?: string
}

function numToken(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0
}

/** Extract Cursor/Claude-style usage object (camelCase or snake_case). */
export function parseCursorUsageObject(raw: unknown): CursorJsonOutput['usage'] | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const u = raw as Record<string, unknown>
  const usage = {
    inputTokens: numToken(u.inputTokens ?? u.input_tokens),
    outputTokens: numToken(u.outputTokens ?? u.output_tokens),
    cacheReadTokens: numToken(u.cacheReadTokens ?? u.cache_read_input_tokens ?? u.cache_read_tokens),
    cacheWriteTokens: numToken(
      u.cacheWriteTokens ?? u.cache_creation_input_tokens ?? u.cache_write_tokens,
    ),
  }
  if (
    usage.inputTokens === 0 &&
    usage.outputTokens === 0 &&
    usage.cacheReadTokens === 0 &&
    usage.cacheWriteTokens === 0
  ) {
    return undefined
  }
  return usage
}

function cursorFieldsFrom(parsed: Record<string, unknown>): CursorJsonOutput {
  const out: CursorJsonOutput = {
    session_id: typeof parsed.session_id === 'string' ? parsed.session_id : undefined,
    result: typeof parsed.result === 'string' ? parsed.result : undefined,
  }
  const usage = parseCursorUsageObject(parsed.usage)
  if (usage) out.usage = usage
  if (typeof parsed.model === 'string' && parsed.model.trim()) out.model = parsed.model.trim()
  return out
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
 *
 * Headless defaults also disable Cursor's nested sandbox and force-approve
 * tools: inside Docker / CI the sandbox backend often cannot start, so Shell
 * fails ("Sandbox mode is enabled but not available on this system").
 * Isolation is the container (or host policy), not Cursor's Landlock helper.
 */
export function buildCursorJsonInvocation(input: CursorJsonInvocationInput): CursorJsonInvocation {
  const base = Array.isArray(input.flags) ? [...input.flags] : []
  if (!base.includes('-p')) base.push('-p')
  if (!base.some((f) => f === '--output-format' || f.startsWith('--output-format='))) {
    base.push('--output-format', 'json')
  }
  const hasSandbox = base.some(
    (f) => f === '--sandbox' || f.startsWith('--sandbox='),
  )
  if (!hasSandbox) base.push('--sandbox', 'disabled')
  const hasForce =
    base.includes('--yolo') || base.includes('-f') || base.includes('--force')
  if (!hasForce) base.push('--force')
  if (!base.includes('--trust')) base.push('--trust')
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
