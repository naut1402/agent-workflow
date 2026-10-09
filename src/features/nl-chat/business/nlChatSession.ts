export type NlChatEntityType = 'task' | 'pipeline' | 'agent' | 'automation'

export type BuilderTurn =
  | { kind: 'question'; text: string }
  | { kind: 'draft'; entityType?: NlChatEntityType; draft: Record<string, unknown> }

const DRAFT_READY_SENTINEL = '===DRAFT_READY==='

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

function unwrapDraft(parsed: Record<string, unknown>): BuilderTurn {
  const { entityType, draft } = parsed as { entityType?: unknown; draft?: unknown }
  if (isEntityType(entityType) && draft && typeof draft === 'object' && !Array.isArray(draft)) {
    return { kind: 'draft', entityType, draft: draft as Record<string, unknown> }
  }
  return { kind: 'draft', draft: parsed }
}

export interface BuildTurnPromptInput {
  /** Target entity when the caller pinned one; omitted in auto mode, where the agent infers it. */
  entityType?: NlChatEntityType | null
  /** 1-based turn counter within the chat session. */
  turnIndex: number
  /** The user's latest message for this turn. */
  message: string
  /** Extra context appended to the end of this turn's prompt (e.g. valid catalog agent refs) — rebuilt every turn, not just turn 1, so entities created mid-session are included. */
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

// xem docs/architecture/code/nl-chat.md §10
const AUTOMATION_EVENT_TYPES_HINT = [
  'job.queued',
  'job.started',
  'job.finished',
  'job.failed',
  'job.cancelled',
  'job.awaiting_recovery',
  'job.retry_scheduled',
  'job.recovered',
  'task.created',
  'task.advanced',
  'hitl.pending',
  'hitl.resolved',
  'entity.created',
  'entity.updated',
  'entity.deleted',
  'webhook.received',
  'webhook.triggered',
  'usage.recorded',
  'orchestrator.dispatched',
  'orchestrator.halted',
  'orchestrator.start_requested',
].join(' | ')

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
        '"profileName" phải là MỘT TÊN CÓ TRONG danh sách [PIPELINE PROFILE] ở khối catalog; muốn dùng pipeline mặc định của project thì BỎ TRỐNG field này. Không có tên nào khớp → hỏi lại người dùng, không tự đặt tên.',
      ].join('\n')
    case 'pipeline':
      return [
        'entityType = pipeline: JSON phải theo shape CreateTaskPipeline: { "version": 1, "steps": [ ... ] }.',
        'Mỗi step BẮT BUỘC có "id" (slug kebab-case, duy nhất trong pipeline) và "name" — Pipeline Editor dùng "id" làm khoá node, thiếu thì profile lưu ra không mở lại được.',
        'Mỗi step phải dùng field "agent" là một ref NẰM TRONG section [AGENT] của khối catalog, chép NGUYÊN VĂN cả tiền tố nguồn — không được bịa ref, không được suy ref từ tên trần.',
        'Các field optional khác của step: skills, produces, knowledge_inputs (mảng), hitl ({ "mode": "none" | ... }).',
        '"skills" của step chỉ nhận TÊN có trong section [SKILL] của khối catalog (không có tiền tố nguồn).',
      ].join('\n')
    case 'agent':
      return [
        'entityType = agent: JSON phải theo đúng shape AgentDraft hiện có của dashboard (name, description, model, skills, sections, section_order).',
        'Tái dùng đúng schema draft agent đã có, không tự bịa field mới.',
        '"skills" chỉ nhận TÊN có trong section [SKILL] của khối catalog — không có tiền tố nguồn, không bịa tên.',
      ].join('\n')
    case 'automation':
      return [
        'entityType = automation: JSON phải là subset field của CreateAutomationRequest.',
        'Bắt buộc: { "name": string (≤100), "triggers": [ …≥1, ≤5 ], "actions": [ …≥1, ≤10 ] }. Optional: "description" (≤500), "enabled" (mặc định true).',
        'Mỗi trigger là MỘT trong:',
        ' - { "kind": "timer", "startAt": "<ISO datetime>", "repeat": { "mode": "once" } }',
        ' - { "kind": "timer", "startAt": "<ISO datetime>", "repeat": { "mode": "interval", "everyMs": <số ms, tối thiểu 60000> } }',
        ' - { "kind": "timer", "startAt": "<ISO datetime>", "repeat": { "mode": "cron", "expr": "<biểu thức 5 field, vd \'0 9 * * 1-5\'>" } }',
        ` - { "kind": "event", "eventType": "<một trong: ${AUTOMATION_EVENT_TYPES_HINT}>" }`,
        'Rule chạy khi BẤT KỲ trigger nào khớp (OR). Nhiều action chạy TUẦN TỰ theo thứ tự mảng.',
        'Mỗi action là MỘT trong:',
        ' - { "kind": "runTask", "mode": "create", "prompt": "<nội dung request.md của task mới>" } (+ optional "name", "description", "profileName", "runnerId", "projectId")',
        ' - { "kind": "runTask", "mode": "existing", "taskId": "<id task>" } (+ optional "name", "description", "runnerId", "projectId")',
        ' - { "kind": "httpRequest", "url": "<https URL>" } (+ optional "method" mặc định GET, "headers", "body")',
        ' - { "kind": "runCommand", "runnerId": "<id runner>" } (+ optional "params")',
        '"profileName" của action runTask cũng phải nằm trong section [PIPELINE PROFILE] của khối catalog — bỏ trống nghĩa là dùng pipeline mặc định.',
        '"projectId" là id project trong registry — bỏ trống nghĩa là project hiện tại. KHÔNG tự bịa id.',
        '"runnerId" KHÔNG có trong catalog: chỉ điền khi người dùng nêu rõ, còn lại bỏ trống để hệ thống chọn runner mặc định.',
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
    if (input.extraContext?.trim()) {
      // xem docs/architecture/code/nl-chat.md §1
      parts.push('')
      parts.push(input.extraContext.trim())
    } else {
      parts.push('(Nhắc lại: chỉ dùng ref/tên có trong catalog đã được cung cấp; không khớp hoặc mơ hồ thì hỏi lại, không tự bịa.)')
    }
    parts.push('')
    parts.push(`Người dùng (lượt ${input.turnIndex}): ${input.message}`)
  }
  return parts.join('\n')
}

import { dirname, joinPath, mkdirSync, readTextFileSync, rmSync } from '../../../backend/lib/fileHelper.js'
import crypto from 'node:crypto'
import { registryHome } from '../../../backend/registry.js'
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

function scratchWorkspace(chatSessionId: string): string {
  return joinPath(registryHome(), 'nlchat-scratch', chatSessionId)
}

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
  /** Extra system context appended to this turn (e.g. valid catalog agent refs for a pipeline draft). */
  extraContext?: string
  /** Resolved `.dev-team-agent/` root, so `resolveAgent()` finds `custom-agents/nl-chat-builder.md` here instead of defaulting to the scratch workspace. */
  devTeamRoot: string
}

export interface NlChatSessionStarted {
  chatSessionId: string
  job: JobRecord
}

/**
 * Start a new NL chat session: mint a `nlchat-<hex>` id used purely as the
 * lookup key for `submitJob`/`sendTaskFeedback` — it is never written to
 * `tasks/<id>/` or `.dev-state/<id>.json`.
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

/** Dựng khối catalog cho lượt sắp gửi theo `entityType`; caller giữ `root`/settings. */
export type NlChatExtraContextBuilder = (
  entityType: NlChatEntityType | null,
) => Promise<string | undefined>

/**
 * Continue an existing chat session with a follow-up message; resuming the CLI
 * session is delegated entirely to `sendTaskFeedback`.
 */
export async function continueNlChatSession(
  chatSessionId: string,
  projectId: string,
  message: string,
  buildExtraContext?: NlChatExtraContextBuilder,
): Promise<MutationResult<{ job: JobRecord }>> {
  const jobs = findChatJobs(chatSessionId)
  if (jobs.length === 0) return { ok: false, status: 404, error: 'unknown chat session' }
  const entityType = entityTypeOf(jobs[jobs.length - 1])

  const extraContext = buildExtraContext ? await buildExtraContext(entityType) : undefined

  const prompt = buildTurnPrompt({
    entityType,
    turnIndex: jobs.length + 1,
    message,
    extraContext,
  })
  // xem docs/architecture/code/nl-chat.md §1
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

// xem docs/architecture/code/nl-chat.md §1
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
