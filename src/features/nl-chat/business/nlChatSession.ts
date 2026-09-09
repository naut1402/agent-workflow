/**
 * Parse the `nl-chat-builder` agent's raw stdout into either a follow-up
 * question (still gathering info) or a ready draft. See design.md §4.2
 * "Output contract của agent nl-chat-builder".
 *
 * Contract: if the agent has enough information to finalize a draft, the
 * FIRST line of its (trimmed) output must be exactly `===DRAFT_READY===`,
 * followed by a fenced ```json block containing the draft. Anything else is
 * treated as a plain-text follow-up question.
 */

export type NlChatEntityType = 'task' | 'pipeline' | 'agent' | 'automation'

export type BuilderTurn =
  | { kind: 'question'; text: string }
  | { kind: 'draft'; entityType?: NlChatEntityType; draft: Record<string, unknown> }

const DRAFT_READY_SENTINEL = '===DRAFT_READY==='

/** Fallback shown to the user when the sentinel is present but JSON parsing fails. */
const DRAFT_PARSE_ERROR_MESSAGE = 'Draft sinh lỗi, vui lòng thử lại.'

export function parseBuilderOutput(stdout: string): BuilderTurn {
  const trimmed = (stdout || '').trim()
  if (!trimmed.startsWith(DRAFT_READY_SENTINEL)) {
    return { kind: 'question', text: trimmed }
  }

  const rest = trimmed.slice(DRAFT_READY_SENTINEL.length)
  const match = rest.match(/\{[\s\S]*\}/)
  if (!match) {
    return { kind: 'question', text: DRAFT_PARSE_ERROR_MESSAGE }
  }

  try {
    const parsed = JSON.parse(match[0])
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { kind: 'question', text: DRAFT_PARSE_ERROR_MESSAGE }
    }
    return unwrapDraft(parsed as Record<string, unknown>)
  } catch {
    return { kind: 'question', text: DRAFT_PARSE_ERROR_MESSAGE }
  }
}

function isEntityType(v: unknown): v is NlChatEntityType {
  return v === 'task' || v === 'pipeline' || v === 'agent' || v === 'automation'
}

/**
 * In auto mode (no `entityType` pinned by the caller) the agent wraps its
 * draft as `{ entityType, draft }` so the client knows which create API to
 * call. A bare draft object (pinned mode) is returned as-is.
 */
function unwrapDraft(parsed: Record<string, unknown>): BuilderTurn {
  const { entityType, draft } = parsed as { entityType?: unknown; draft?: unknown }
  if (isEntityType(entityType) && draft && typeof draft === 'object' && !Array.isArray(draft)) {
    return { kind: 'draft', entityType, draft: draft as Record<string, unknown> }
  }
  return { kind: 'draft', draft: parsed }
}

export interface BuildTurnPromptInput {
  /**
   * Target entity, when the caller pinned one. Omitted (auto mode) for the
   * floating chat surface: the user just chats, and the agent decides which
   * of task/pipeline/agent the draft is for.
   */
  entityType?: NlChatEntityType | null
  /** 1-based turn counter within the chat session. */
  turnIndex: number
  /** The user's latest message for this turn. */
  message: string
  /**
   * Extra context to append on turn 1 only — e.g. the valid `agent` refs from
   * the catalog, needed so a `pipeline` draft only references real agents.
   */
  extraContext?: string
}

const OUTPUT_CONTRACT_HEADER = [
  'Bạn là agent hội thoại "nl-chat-builder" — phỏng vấn người dùng bằng ngôn ngữ tự nhiên để tạo cấu hình cho hệ thống dev-team-dashboard.',
  '',
  'Output contract (BẮT BUỘC tuân theo ở MỌI lượt trả lời):',
  '- Nếu còn thiếu thông tin bắt buộc: trả lời thuần văn bản, đặt câu hỏi ngắn gọn cho người dùng. KHÔNG có sentinel, KHÔNG có JSON.',
  '- Nếu đã đủ thông tin để chốt draft: dòng ĐẦU TIÊN của output phải là chính xác `===DRAFT_READY===`, theo sau là một fenced code block ```json chứa draft.',
].join('\n')

const AUTO_MODE_HEADER = [
  'Người dùng đang chat tự do — CHƯA chọn sẵn loại đối tượng cần tạo.',
  'Bạn phải tự suy ra người dùng muốn tạo `task`, `pipeline`, `agent` hay `automation` từ nội dung hội thoại;',
  'nếu chưa rõ thì hỏi lại bằng văn bản thuần (đây cũng là câu hỏi bình thường, không phải form).',
  'Nếu người dùng chỉ hỏi han/trao đổi mà chưa muốn tạo gì, cứ trả lời như một trợ lý bình thường — KHÔNG ép chốt draft.',
  'Khi chốt draft, JSON trong code block phải là wrapper: { "entityType": "task" | "pipeline" | "agent" | "automation", "draft": { ...draft đúng schema của entityType đó... } }.',
].join('\n')

function schemaHintFor(entityType?: NlChatEntityType | null): string {
  if (!entityType) {
    return [
      AUTO_MODE_HEADER,
      '',
      schemaHintFor('task'),
      '',
      schemaHintFor('pipeline'),
      '',
      schemaHintFor('agent'),
      '',
      schemaHintFor('automation'),
    ].join('\n')
  }
  switch (entityType) {
    case 'task':
      return [
        'entityType = task: JSON phải là subset field của CreateTaskRequest.',
        'Tối thiểu bắt buộc: { "prompt": string, "name": string (≤60 ký tự, mô tả ngắn gọn task, khác với "taskId") }. Field "taskId" là optional — nếu người dùng không chỉ định, hệ thống sẽ tự sinh mã ngẫu nhiên.',
        'Các field khác (source, profileName, pipeline, knowledgeInputs, ...) là optional — chỉ thêm khi người dùng cung cấp, giữ nguyên default của Zod nếu không.',
      ].join('\n')
    case 'pipeline':
      return [
        'entityType = pipeline: JSON phải theo shape CreateTaskPipeline: { "version": 1, "steps": [ ... ] }.',
        'Mỗi step BẮT BUỘC có "id" (slug kebab-case, duy nhất trong pipeline) và "name" — Pipeline Editor dùng "id" làm khoá node, thiếu thì profile lưu ra không mở lại được.',
        'Mỗi step phải dùng field "agent" là một ref NẰM TRONG danh sách catalog agent hợp lệ đã cung cấp ở lượt đầu tiên — không được bịa ref không có trong danh sách.',
        'Các field optional khác của step: skills, produces, knowledge_inputs (mảng), hitl ({ "mode": "none" | ... }).',
      ].join('\n')
    case 'agent':
      return [
        'entityType = agent: JSON phải theo đúng shape AgentDraft hiện có của dashboard (name, description, model, skills, sections, section_order).',
        'Tái dùng đúng schema draft agent đã có, không tự bịa field mới.',
      ].join('\n')
    case 'automation':
      return [
        'entityType = automation: JSON phải là subset field của CreateAutomationRequest cho rule tự động hoá (trigger → action).',
        'Bắt buộc: { "name": string, "trigger": {...}, "action": {...} }. Optional: "description", "enabled" (mặc định true).',
        'trigger là MỘT trong: { "kind": "time", "at": "<ISO datetime>" } (chạy một lần) | { "kind": "interval", "everyMs": <số ms, tối thiểu 60000> } (định kỳ) | { "kind": "cron", "cron": "<biểu thức 5 field, vd \'0 9 * * 1-5\'>" } | { "kind": "event", "eventType": "<domain event, vd \'job.failed\', \'hitl.pending\', \'task.created\'>" }.',
        'action là MỘT trong: { "kind": "runTask", "mode": "create", "prompt": "<prompt cho task mới>" (+ optional "profileName", "runnerId", "projectId") } | { "kind": "runTask", "mode": "existing", "taskId": "<id task>" } (+ optional "runnerId", "projectId").',
        '"projectId" là id project trong registry — bỏ trống nghĩa là chạy trên project hiện tại. Không tự bịa id: chỉ điền khi người dùng nêu rõ project đích.',
        'Luôn hỏi người dùng muốn chạy task MỚI (cần prompt) hay task CÓ SẴN (cần taskId) khi chưa rõ.',
      ].join('\n')
    default:
      return ''
  }
}

/**
 * Build the `userPrompt` sent to `submitJob`/`sendTaskFeedback` for one chat
 * turn. The CLI session itself remembers conversation history (resumed via
 * `sessionId`), so every turn only needs to (re)state the output contract
 * briefly plus the user's new message — not the full transcript.
 */
export function buildTurnPrompt(input: BuildTurnPromptInput): string {
  const parts: string[] = []
  if (input.turnIndex <= 1) {
    parts.push(OUTPUT_CONTRACT_HEADER)
    parts.push('')
    parts.push(schemaHintFor(input.entityType))
    if (input.extraContext?.trim()) {
      parts.push('')
      parts.push(input.extraContext.trim())
    }
    parts.push('')
    parts.push(`Người dùng (lượt 1): ${input.message}`)
  } else {
    const draftShape = input.entityType
      ? `draft đúng schema ${input.entityType}`
      : 'wrapper { "entityType": ..., "draft": ... } đúng schema của entityType bạn đã suy ra'
    parts.push(`(Nhắc lại ngắn gọn output contract: nếu đủ thông tin, dòng đầu tiên phải là ${'`'}===DRAFT_READY===${'`'} theo sau là fenced ${'```'}json chứa ${draftShape}; nếu chưa đủ, chỉ hỏi lại bằng văn bản thuần.)`)
    parts.push('')
    parts.push(`Người dùng (lượt ${input.turnIndex}): ${input.message}`)
  }
  return parts.join('\n')
}

import { dirname, joinPath, mkdirSync, readTextFileSync, rmSync } from '../../../core/lib/fileHelper.js'
import crypto from 'node:crypto'
import { registryHome } from '../../../core/registry.js'
import {
  submitJob,
  sendTaskFeedback,
  listJobs,
  closeTaskSession,
} from './index.js'
import type { JobRecord, MutationResult } from './index.js'


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
  return joinPath(registryHome(), 'nlchat-scratch', chatSessionId)
}

/** Jobs tagged with this chat session, oldest first. */
function findChatJobs(chatSessionId: string): JobRecord[] {
  return listJobs(200)
    .filter((j) => j.metadata?.taskId === chatSessionId)
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
}

function entityTypeOf(job: JobRecord | undefined): NlChatEntityType | null {
  const t = job?.metadata?.entityType
  return t === 'task' || t === 'pipeline' || t === 'agent' || t === 'automation' ? t : null
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
  mkdirSync(workspace, { recursive: true })

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
      projectRoot: dirname(input.devTeamRoot),
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
export async function continueNlChatSession(
  chatSessionId: string,
  projectId: string,
  message: string,
): Promise<MutationResult<{ job: JobRecord }>> {
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
  // Chat sessions here are scratch-only (no `.dev-state` file), so
  // `sendTaskFeedback` can never actually return `{ queued: true }` for one —
  // an active job still surfaces as the original "busy" error.
  const result = await sendTaskFeedback(chatSessionId, projectId, prompt)
  if ('error' in result) return result
  if ('job' in result) return { ok: true, job: result.job }
  return { ok: false, status: 409, error: 'step already running' }
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
    log = job.logPath ? readTextFileSync(job.logPath) : ''
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
      rmSync(workspace, { recursive: true, force: true })
    } catch {
      /* best-effort cleanup only */
    }
  }
}
