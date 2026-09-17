/**
 * Vòng lặp điều phối — một subscriber wildcard duy nhất trên event bus.
 *
 * Agent được hỏi ở **mọi** chuyển tiếp: mốc duy nhất là `job.finished` của một
 * job step, vì chỉ ở đó cursor đã dịch và `stdout`/`artifactsFound` đã được ghi.
 * Dispatch tất định vẫn còn, nhưng lùi về làm lưới an toàn khi lượt agent không
 * dùng được — pipeline không dừng vì một output hỏng.
 *
 * Chống tự-kích + coalesce theo mẫu đã chạy thật của feature `automations`
 * (`eventTrigger.ts`): bỏ mọi event `orchestrator.*`, khoá `inFlight` theo
 * `${root}::${taskId}`, guard `BUN_TEST`, `handleEvent` export thuần để test.
 */

import { dirname, joinPath, readDir, readTextFile, stat } from '../../../backend/lib/fileHelper.js'
import { emit, on, type DashboardEvent } from '../../../backend/events/index.js'
import { loadRegistry } from '../../../backend/registry.js'
import { readState } from '../../monitor/business/tasks/index.js'
import { advanceStepOnJobSuccess } from '../../monitor/business/tasks/state.js'
import {
  resolveOrchestration,
  stateFileOf,
  type Orchestration,
} from '../../monitor/business/tasks/startAuthority.js'
import { applyOrchestratorHaltAction } from '../../monitor/business/tasks/state.js'
import { listJobs, loadJob, loadTaskSessionLedger, submitJob } from '../../runner/business/index.js'
import type { JobRecord } from '../../runner/business/index.js'
import { loadPipelineConfig } from '../../pipeline-editor/business/pipeline/index.js'
import { ORCHESTRATOR_STEP_ID, type OrchestratorDecision } from '../schemas/orchestrator.js'
import { composeStepBrief, type AgentContext, type DispatchReason } from './brief.js'
import {
  buildDecisionPrompt,
  hasDecisionLine,
  parseDecision,
  type DecisionTrigger,
  type StepResult,
} from './decision.js'

/** Quét lại task treo mỗi 60s — lưới cứu khi event bus (in-process) mất tín hiệu. */
export const SWEEP_INTERVAL_MS = 60_000

/** Số event gần nhất giữ lại cho mỗi task, làm bối cảnh cho lượt hỏi agent. */
const OBSERVATION_LIMIT = 50

/** Số task giữ ring buffer cùng lúc — dashboard chạy dài có thể thấy hàng nghìn task. */
const OBSERVED_TASK_LIMIT = 200

/**
 * Số lần được hỏi agent vì **job lỗi** cho mỗi `(task, step)` trước khi dừng hẳn.
 * Không có mốc này thì một step lỗi cố định (agent ref sai, worktree hỏng) sẽ
 * đốt một lượt LLM + một lượt job mỗi vòng, vô hạn. Đặt bằng `review_retry_max`
 * mặc định để hai cơ chế lùi-bước có cùng độ kiên nhẫn.
 */
const MAX_FAILURE_ASKS = 2

/**
 * Số lượt agent tự động cho mỗi `(task, phase)` trước khi dừng hẳn. Agent trả
 * `start` trỏ lại chính step vừa xong là một vòng vô hạn tốn LLM. Bằng 2×
 * `review_retry_max` mặc định, cộng dư cho lượt tóm tắt tại cổng.
 */
const MAX_TURNS_PER_PHASE = 6

/**
 * Event khiến orchestrator **hành động**. Nó vẫn nghe mọi event và ghi vào ring
 * buffer. `job.finished` của một job step là mốc "bước xong" duy nhất;
 * `task.advanced` ở đây chỉ để dọn khi pipeline hoàn tất, không tốn lượt LLM.
 */
const ACTIONABLE = new Set([
  'job.finished',
  'job.failed',
  'hitl.resolved',
  'task.advanced',
  'orchestrator.start_requested',
])

/**
 * Trigger mà bước kế là tất định — lượt agent hỏng thì chuyển tiếp theo thứ tự
 * pipeline. Với `gate_rejected` / `job_failed` thì không: ở đó không có bước kế
 * nào đúng, đoán bừa là chạy sai mà không ai thấy.
 */
const FALLBACK_TRIGGERS = new Set<DecisionTrigger>(['step_finished', 'manual_start', 'gate_approved'])

const inFlight = new Set<string>()
const observations = new Map<string, string[]>()
const failureAsks = new Map<string, number>()
const turnsAtPhase = new Map<string, number>()
let loopStarted = false
let sweepTimer: ReturnType<typeof setInterval> | null = null

function keyOf(root: string, taskId: string): string {
  return `${root}::${taskId}`
}

function recordObservation(root: string, taskId: string, event: DashboardEvent): void {
  const key = keyOf(root, taskId)
  const list = observations.get(key) ?? []
  const detail = event.payload?.error ?? event.payload?.reason ?? event.payload?.currentPhase
  list.push(`${event.at} ${event.type}${detail ? ` — ${String(detail)}` : ''}`)
  if (list.length > OBSERVATION_LIMIT) list.splice(0, list.length - OBSERVATION_LIMIT)
  // Ghi lại khoá (delete rồi set) để Map giữ đúng thứ tự dùng gần nhất — task
  // im lặng lâu nhất là task bị loại đầu tiên.
  observations.delete(key)
  observations.set(key, list)
  while (observations.size > OBSERVED_TASK_LIMIT) {
    const oldest = observations.keys().next().value
    if (oldest === undefined) break
    observations.delete(oldest)
  }
}

/** Task kết thúc / dừng điều phối thì không còn gì để nhớ. */
function forgetTask(root: string, taskId: string): void {
  const key = keyOf(root, taskId)
  observations.delete(key)
  for (const map of [failureAsks, turnsAtPhase]) {
    for (const k of [...map.keys()]) {
      if (k.startsWith(`${key}::`)) map.delete(k)
    }
  }
}

function recentOf(root: string, taskId: string, count = 8): string[] {
  return (observations.get(keyOf(root, taskId)) ?? []).slice(-count)
}

/** Data root của một project, tra ngược từ path (event mang root, không mang id). */
function projectIdOfRoot(root: string): string {
  try {
    return loadRegistry().projects.find((p) => p.path === root)?.id ?? ''
  } catch {
    return ''
  }
}

export interface TaskRef {
  taskId: string
  root: string
  projectId: string
}

/**
 * Task mà một event nói về. Ưu tiên payload (`task.*` / `hitl.*` mang
 * `devTeamRoot`), rồi mới tới metadata của job (`job.*` chỉ mang `jobId`).
 */
export function identifyTask(event: DashboardEvent, job?: JobRecord | null): TaskRef | null {
  const payload = (event.payload ?? {}) as Record<string, unknown>
  let taskId = typeof payload.taskId === 'string' ? payload.taskId : ''
  let root = typeof payload.devTeamRoot === 'string' ? payload.devTeamRoot : ''
  let projectId = typeof payload.projectId === 'string' ? payload.projectId : ''

  if (!taskId || !root) {
    const meta = (job === undefined ? jobOfEvent(event) : job)?.metadata ?? {}
    if (!taskId && typeof meta.taskId === 'string') taskId = meta.taskId
    if (!root && typeof meta.devTeamRoot === 'string') root = meta.devTeamRoot
    if (!projectId && typeof meta.projectId === 'string') projectId = meta.projectId
  }

  if (!taskId || !root) return null
  return { taskId, root, projectId: projectId || projectIdOfRoot(root) }
}

function jobOfEvent(event: DashboardEvent): JobRecord | null {
  const jobId = (event.payload as Record<string, unknown>)?.jobId
  return typeof jobId === 'string' ? loadJob(jobId) : null
}

function isOrchestratorJob(job: JobRecord | null): boolean {
  return job?.metadata?.orchestratorJob === true
}

/**
 * Lượt không đẩy cursor pipeline: job approval, hoặc lượt chat của người dùng —
 * lượt chat kế thừa `pipelineStepId` của job cha (cùng quy tắc `runJob` dùng để
 * bỏ qua advance). Lượt orchestrator resume thì LÀ lượt chạy lại của step.
 */
function isNonAdvancingTurn(job: JobRecord): boolean {
  const meta = job.metadata ?? {}
  return Boolean(job.applyTarget) || (meta.isChatFeedback === true && meta.orchestratorResume !== true)
}

/** Job của một step thật — mốc duy nhất mở một lượt agent. */
function isStepJob(job: JobRecord): boolean {
  const meta = job.metadata ?? {}
  return Boolean(meta.pipelineStepId) && meta.orchestratorJob !== true && !isNonAdvancingTurn(job)
}

function isLiveStatus(status: string | undefined): boolean {
  return status === 'queued' || status === 'running' || status === 'awaiting_recovery'
}

/** `devTeamRoot` thiếu ở job cũ — coi như thuộc root đang xét. */
function jobBelongsToTask(job: JobRecord, root: string, taskId: string): boolean {
  const meta = job.metadata ?? {}
  return meta.taskId === taskId && (!meta.devTeamRoot || meta.devTeamRoot === root)
}

function liveJobsOfTask(root: string, taskId: string): JobRecord[] {
  return listJobs(50).filter((j) => isLiveStatus(j.status) && jobBelongsToTask(j, root, taskId))
}

/** Job đang sống của task — bỏ qua job quyết định của chính orchestrator. */
function hasActiveStepJob(root: string, taskId: string): boolean {
  return liveJobsOfTask(root, taskId).some((j) => !isOrchestratorJob(j))
}

/** Lượt agent đang chạy dở. Hai job cùng `resume` một session là hỏng transcript. */
function hasActiveOrchestratorJob(root: string, taskId: string): boolean {
  return liveJobsOfTask(root, taskId).some(isOrchestratorJob)
}

async function readStateRecord(root: string, taskId: string): Promise<Record<string, unknown> | null> {
  const read = await readState(stateFileOf(root, taskId))
  return read.ok ? (read.state as Record<string, unknown>) : null
}

/** Ảnh chụp cursor của task — nguồn chung cho mọi nhánh cần "đang ở bước nào". */
interface TaskPhase {
  phase: string
  /** Gate đang chờ người duyệt, nếu có. */
  gatePending?: string
}

async function readTaskPhase(root: string, taskId: string): Promise<TaskPhase> {
  const state = (await readStateRecord(root, taskId)) ?? {}
  const gate = state.hitl_pending
  return { phase: String(state.current_phase ?? ''), gatePending: gate ? String(gate) : undefined }
}

/** Còn bước để chạy — cursor chưa đi hết pipeline. */
function hasPendingStep(at: TaskPhase): boolean {
  return Boolean(at.phase) && at.phase !== 'completed'
}

function refOf(root: string, projectId: string | null, taskId: string): TaskRef {
  return { root, taskId, projectId: projectId || projectIdOfRoot(root) }
}

/* Hành động */

function emitDispatched(
  ref: TaskRef,
  detail: { stepId?: string; action: string; reason?: string },
): void {
  emit('orchestrator.dispatched', {
    taskId: ref.taskId,
    projectId: ref.projectId || undefined,
    devTeamRoot: ref.root,
    ...detail,
  })
}

/**
 * Dừng điều phối và **trả quyền chạy tay** cho người dùng: `assertStartAllowed`
 * đọc `enabled && !halted`, nên sau halt thì Run/Reset trên node step hiện lại.
 * Đây là lối thoát duy nhất khi orchestrator không quyết được — không đoán bừa.
 */
export async function haltTask(ref: TaskRef, reason: string): Promise<void> {
  forgetTask(ref.root, ref.taskId)
  // `applyOrchestratorHaltAction` kiểm mtime để chặn ghi đè một thay đổi song
  // song — ở đây không có "phiên bản người dùng đang xem", nên đọc mtime hiện
  // tại ngay trước khi ghi.
  let mtime: number
  try {
    mtime = (await stat(stateFileOf(ref.root, ref.taskId))).mtimeMs
  } catch {
    return // task không còn state file — không có gì để halt
  }
  await applyOrchestratorHaltAction(ref.root, ref.taskId, { halted: true, mtime })
  emit('orchestrator.halted', {
    taskId: ref.taskId,
    projectId: ref.projectId || undefined,
    devTeamRoot: ref.root,
    reason,
  })
}

/**
 * Start một step. Luôn đi qua `runTaskStep` — đó là nơi giữ khoá task, guard
 * 409 và auto-advance; gọi thẳng `submitJob` là bỏ hết những thứ đó.
 *
 * Import động: `runStep.js` kéo theo barrel runner, mà runner lại re-export
 * module của monitor — dynamic import giữ vòng đó không chạy lúc module-eval
 * (cùng lý do với `state.ts`).
 */
export async function dispatchStep(
  ref: TaskRef,
  stepId: string,
  reason: DispatchReason,
  detail?: string,
  agentContext?: AgentContext,
): Promise<void> {
  let brief: string
  try {
    brief = await composeStepBrief({
      root: ref.root,
      taskId: ref.taskId,
      stepId,
      reason,
      detail,
      agentContext,
    })
  } catch (err: any) {
    await haltTask(ref, `cannot compose brief: ${String(err?.message ?? err)}`)
    return
  }

  emitDispatched(ref, { stepId, action: 'start', reason })

  const { runTaskStep } = await import('../../monitor/business/tasks/runStep.js')
  const result = await runTaskStep(ref.root, ref.projectId || null, ref.taskId, {
    origin: 'orchestrator',
    userPrompt: brief,
    // Pin step: nếu không truyền thì `runTaskStep` chọn step theo `current_phase`
    // và theo khối tự-chữa của nó — brief soạn cho step này mà job lại chạy step
    // khác. `skipIntermediate` để step đích được nhảy tới tường minh (và bị từ
    // chối tường minh khi nó nằm phía sau cursor).
    targetStepId: stepId,
    skipIntermediate: true,
  })
  if (result.ok === false) {
    // 409 = task đang có job step chạy. Đó là "thử lại sau", không phải "không
    // quyết được" — halt ở đây sẽ dừng pipeline vì một lần chạy chồng vô hại;
    // `sweepStuckTasks` nhặt lại nếu bước kế thật sự bị bỏ quên.
    if (result.status === 409) {
      console.warn(`[orchestrator] dispatch deferred for ${ref.taskId}/${stepId}: ${result.error}`)
      return
    }
    await haltTask(ref, `dispatch failed: ${result.error}`)
  }
}

/**
 * Gửi tiếp cho step đang chạy dở — cơ chế *resume* của đề bài.
 * KHÔNG dùng `resetPipelineStep*`: đường đó xoá artifact của step (và cascade).
 */
export async function resumeStep(ref: TaskRef, stepId: string, message: string): Promise<void> {
  emitDispatched(ref, { stepId, action: 'resume', reason: 'resume' })

  const { sendTaskFeedback } = await import('../../runner/business/index.js')
  const result = await sendTaskFeedback(ref.taskId, ref.projectId, message, {
    stepId,
    source: 'orchestrator',
    orchestratorResume: true,
    // Resume một step chưa từng chạy là quyết định sai của agent — halt kèm lý
    // do, đừng để phản hồi rơi vào session của step khác.
    requireStepMatch: true,
  })
  if (result.ok === false) await haltTask(ref, `resume failed: ${result.error}`)
}

/** Dữ liệu thêm cho một lượt hỏi agent, ngoài trigger và phase. */
export interface TurnInput {
  detail?: string
  stepResult?: StepResult
  gatePending?: string
}

export type TurnResult = { job: JobRecord } | { error: string; status: number }

/**
 * Một lượt hỏi agent. Không chặn ở đây: quyết định đọc lại ở `job.finished` của
 * chính job này (vòng lặp tự nhận lại), nên một lượt suy nghĩ dài không giữ
 * khoá `inFlight` của task.
 */
async function askAgent(
  ref: TaskRef,
  orch: Orchestration,
  trigger: DecisionTrigger,
  currentPhase: string,
  extra: TurnInput = {},
): Promise<TurnResult> {
  if (!orch.agent) {
    await haltTask(ref, 'orchestrator.agent is not configured')
    return { error: 'orchestrator.agent is not configured', status: 400 }
  }
  if (hasActiveOrchestratorJob(ref.root, ref.taskId)) {
    return { error: 'orchestrator busy', status: 409 }
  }
  // Lượt do người khởi xướng không đếm: nó cần một thao tác tay mỗi lần, nên
  // không tự nuôi được vòng lặp mà mốc này sinh ra để chặn.
  if (trigger !== 'chat' && trigger !== 'manual_start') {
    const key = `${keyOf(ref.root, ref.taskId)}::${currentPhase}`
    const turns = (turnsAtPhase.get(key) ?? 0) + 1
    if (turns > MAX_TURNS_PER_PHASE) {
      await haltTask(ref, `orchestrator turn loop at ${currentPhase || '(chưa có)'}`)
      return { error: 'orchestrator turn loop', status: 409 }
    }
    turnsAtPhase.set(key, turns)
  }

  const pipeline = await loadPipelineConfig(ref.root, ref.taskId)
  const stepIds = (pipeline.steps || []).map((s: any) => s?.id).filter(Boolean)

  // `resolveSessionPlan` với `resume` sẽ bắt entry open MỚI NHẤT khi chưa có
  // entry nào mang `stepId` cần tìm — tức là session của một step. Vì vậy lượt
  // đầu của orchestrator luôn phải là `new`.
  const ledger = loadTaskSessionLedger(ref.projectId, ref.taskId)
  const hasOwnSession = ledger.sessions.some(
    (s) => s.status === 'open' && s.stepIds?.includes(ORCHESTRATOR_STEP_ID),
  )

  const job = submitJob({
    agentRef: orch.agent,
    workspace: joinPath(ref.root, 'tasks', ref.taskId),
    userPrompt: buildDecisionPrompt({
      taskId: ref.taskId,
      currentPhase,
      stepIds,
      trigger,
      detail: extra.detail,
      stepResult: extra.stepResult,
      gatePending: extra.gatePending,
      recent: recentOf(ref.root, ref.taskId),
    }),
    sessionMode: hasOwnSession ? 'resume' : 'new',
    metadata: {
      projectRoot: dirname(ref.root),
      devTeamRoot: ref.root,
      projectId: ref.projectId || undefined,
      taskId: ref.taskId,
      // KHÔNG đặt `pipelineStepId`: job này không phải một step, và đặt vào là
      // `advancePipelineStepChain` sẽ đẩy cursor khi nó xong.
      stepId: ORCHESTRATOR_STEP_ID,
      orchestratorJob: true,
      // Phân biệt "lượt quyết định" với "lượt trò chuyện": output rỗng ở lượt
      // quyết định là sự cố phải xử lý, ở lượt chat thì chỉ là im lặng.
      orchestratorTrigger: trigger,
    },
  })
  return { job }
}

/** Bối cảnh thi hành một quyết định — đọc từ state ngay trước khi áp dụng. */
interface DecisionOutcomeContext {
  gatePending?: string
  completed: boolean
}

async function applySummary(
  ref: TaskRef,
  decision: OrchestratorDecision,
  ctx: DecisionOutcomeContext,
): Promise<void> {
  emitDispatched(ref, { action: 'summary', reason: decision.reason || 'summary' })
  if (ctx.completed) forgetTask(ref.root, ref.taskId)
}

async function applyStart(
  ref: TaskRef,
  decision: OrchestratorDecision,
  ctx: DecisionOutcomeContext,
): Promise<void> {
  // `start` khi cổng đang chờ người là quyết định không thi hành được
  // (`runTaskStep` trả 400) — hạ xuống `summary`: pipeline đang chờ đúng quy
  // trình, không phải lỗi.
  if (ctx.gatePending) {
    emitDispatched(ref, { action: 'summary', reason: 'gate_pending' })
    return
  }
  await dispatchStep(ref, decision.stepId as string, 'agent_start', decision.message, {
    summary: decision.summary,
    context: decision.context,
  })
}

type DecisionHandler = (
  ref: TaskRef,
  decision: OrchestratorDecision,
  ctx: DecisionOutcomeContext,
) => Promise<void>

/** Mỗi hành động một nhánh thi hành. `message` của `resume` đã được schema bắt buộc. */
const ACTION_HANDLERS: Record<OrchestratorDecision['action'], DecisionHandler> = {
  halt: (ref, decision) => haltTask(ref, decision.reason || 'agent decided to halt'),
  summary: applySummary,
  resume: (ref, decision) => resumeStep(ref, decision.stepId as string, decision.message as string),
  start: applyStart,
}

/** Thi hành quyết định đã parse. Mọi nhánh không hợp lệ đều đã bị chặn trước đó. */
function applyDecision(
  ref: TaskRef,
  decision: OrchestratorDecision,
  ctx: DecisionOutcomeContext,
): Promise<void> {
  return ACTION_HANDLERS[decision.action](ref, decision, ctx)
}

/**
 * Lượt agent không dùng được ⇒ chuyển tiếp theo thứ tự pipeline thay vì dừng.
 * Chỉ gọi với trigger mà bước kế là tất định (xem `FALLBACK_TRIGGERS`).
 */
async function fallbackDispatch(ref: TaskRef, reason: string): Promise<void> {
  const at = await readTaskPhase(ref.root, ref.taskId)
  if (!hasPendingStep(at) || at.gatePending) return
  emitDispatched(ref, { stepId: at.phase, action: 'start', reason: `agent_fallback: ${reason}` })
  await dispatchStep(ref, at.phase, 'advance')
}

/** Lượt agent hỏng: chuyển tiếp tất định nếu bước kế biết trước, còn lại thì halt. */
async function recoverFromBadTurn(
  ref: TaskRef,
  trigger: DecisionTrigger | undefined,
  reason: string,
): Promise<void> {
  if (trigger && FALLBACK_TRIGGERS.has(trigger)) {
    await fallbackDispatch(ref, reason)
    return
  }
  await haltTask(ref, reason)
}

/* Bảng quyết định */

async function readFeedbackFile(root: string, taskId: string): Promise<string> {
  try {
    return await readTextFile(joinPath(root, 'tasks', taskId, 'hitl-feedback.md'))
  } catch {
    return ''
  }
}

/**
 * Quyết định cho một event đã lọc. `job.finished` của một job step là mốc mở
 * lượt agent; các nhánh còn lại chỉ dọn dẹp hoặc xử lý ngoại lệ.
 */
export async function decide(
  ref: TaskRef,
  orch: Orchestration,
  event: DashboardEvent,
  eventJob?: JobRecord | null,
): Promise<void> {
  const payload = (event.payload ?? {}) as Record<string, unknown>

  if (event.type === 'task.advanced') {
    // Lượt tóm tắt cuối do `job.finished` của step cuối lo; ở đây chỉ còn việc
    // phát mốc kết thúc và quên task.
    const currentPhase = String(payload.currentPhase ?? '')
    if (!currentPhase || currentPhase === 'completed') {
      emitDispatched(ref, { action: 'idle', reason: 'pipeline completed' })
      forgetTask(ref.root, ref.taskId)
    }
    return
  }

  if (event.type === 'job.finished') {
    const job = eventJob ?? jobOfEvent(event)
    if (!job || !isStepJob(job)) return
    const at = await readTaskPhase(ref.root, ref.taskId)
    // Pipeline tiến được một bước ⇒ chuỗi lỗi (nếu có) của step đó đã được gỡ.
    const stepId = String(job.metadata?.pipelineStepId ?? '')
    failureAsks.delete(`${keyOf(ref.root, ref.taskId)}::${stepId}`)
    const trigger = hasPendingStep(at) ? 'step_finished' : 'pipeline_completed'
    await askAgent(ref, orch, trigger, at.phase, {
      stepResult: stepResultOf(job, stepId, 'succeeded'),
      gatePending: at.gatePending,
    })
    return
  }

  if (event.type === 'orchestrator.start_requested') {
    // Automation bị từ chối (409) vì task đang được điều phối — xin một lượt
    // quyết định thay vì tự chạy step.
    const at = await readTaskPhase(ref.root, ref.taskId)
    if (!hasPendingStep(at) || at.gatePending) return
    await askAgent(ref, orch, 'manual_start', at.phase, { gatePending: at.gatePending })
    return
  }

  if (event.type === 'hitl.resolved') {
    // Gate bị hệ thống tự huỷ vì pipeline đổi hình dạng — không phải quyết định
    // của người, không có gì để điều phối.
    if (payload.reason === 'pipeline_changed') return

    const currentPhase = String(payload.currentPhase ?? '')
    const approved = payload.action === 'approve'
    if (approved && (!currentPhase || currentPhase === 'completed')) return
    await askAgent(ref, orch, approved ? 'gate_approved' : 'gate_rejected', currentPhase, {
      detail: await readFeedbackFile(ref.root, ref.taskId),
    })
    return
  }

  if (event.type === 'job.failed') {
    const job = eventJob ?? jobOfEvent(event)
    const stepId = typeof job?.metadata?.pipelineStepId === 'string' ? job.metadata.pipelineStepId : ''
    if (!stepId) return
    const key = `${keyOf(ref.root, ref.taskId)}::${stepId}`
    const asked = (failureAsks.get(key) ?? 0) + 1
    if (asked > MAX_FAILURE_ASKS) {
      await haltTask(ref, `failure loop: ${stepId} failed ${asked} times`)
      return
    }
    failureAsks.set(key, asked)
    await askAgent(ref, orch, 'job_failed', stepId, {
      detail: String(payload.error ?? job?.error ?? ''),
      stepResult: stepResultOf(job, stepId, 'failed'),
    })
  }
}

function stdoutOf(job: JobRecord | null): string {
  return typeof job?.stdout === 'string' ? job.stdout : ''
}

/** Kết quả một lượt chạy step, gói lại cho prompt của agent. */
function stepResultOf(
  job: JobRecord | null,
  stepId: string,
  status: StepResult['status'],
): StepResult {
  return { stepId, status, artifacts: job?.artifactsFound ?? [], output: stdoutOf(job) }
}

/* Subscriber */

/**
 * Điểm vào duy nhất từ event bus. Export thuần (không tự đăng ký) để test gọi
 * thẳng — đăng ký thật nằm ở `startOrchestratorLoop`.
 */
export async function handleEvent(event: DashboardEvent): Promise<void> {
  // Chống tự-kích: mọi thứ orchestrator phát ra đều không được quay lại nó —
  // trừ `orchestrator.start_requested`, event automation xin một lượt quyết định.
  if (event.type !== 'orchestrator.start_requested' && String(event.type).startsWith('orchestrator.')) return

  // Một lần `loadJob` cho cả `identifyTask` lẫn các nhánh bên dưới — hàm này
  // chạy trên MỌI event của bus, nên mỗi lần đọc đĩa thừa là thừa toàn cục.
  const job = jobOfEvent(event)
  const ref = identifyTask(event, job)
  if (!ref) return
  recordObservation(ref.root, ref.taskId, event)

  // Job quyết định của chính orchestrator: đây là chỗ đọc kết quả một lượt hỏi.
  // Nhánh này phải đứng TRƯỚC `ACTIONABLE`, nếu không `job.finished` của chính
  // lượt agent sẽ tự kích một lượt mới — đó là cách sinh bão job.
  if (isOrchestratorJob(job)) {
    if (event.type === 'job.failed') {
      const trigger = job?.metadata?.orchestratorTrigger as DecisionTrigger | undefined
      await recoverFromBadTurn(ref, trigger, 'orchestrator_job_failed')
      return
    }
    if (event.type === 'job.finished') await consumeAgentDecision(ref, job as JobRecord)
    return
  }

  if (!ACTIONABLE.has(event.type)) return

  const orch = await resolveOrchestration(ref.root, ref.taskId)
  if (!orch.active) return
  // Đã thấy một task đang được điều phối ⇒ từ giờ mới cần quét định kỳ.
  ensureSweepScheduled()

  // `task.advanced` chỉ dọn dẹp, không dispatch. Giữ khoá cho nó là chặn mất
  // lượt `job.finished` mà cùng lần chạy job phát ra ngay sau đó.
  if (event.type === 'task.advanced') {
    await decide(ref, orch, event, job)
    return
  }

  const key = keyOf(ref.root, ref.taskId)
  if (inFlight.has(key)) return
  inFlight.add(key)
  try {
    await decide(ref, orch, event, job)
  } finally {
    inFlight.delete(key)
  }
}

/**
 * Đọc quyết định từ output của job orchestrator.
 *
 * Output **không có** dòng sentinel ⇒ đây chỉ là một lượt hội thoại (người dùng
 * chat với node), không làm gì. Có sentinel nhưng hỏng ⇒ lưới tất định.
 */
async function consumeAgentDecision(ref: TaskRef, job: JobRecord): Promise<void> {
  const orch = await resolveOrchestration(ref.root, ref.taskId)
  if (!orch.active) return

  const stdout = stdoutOf(job)
  const trigger = job.metadata?.orchestratorTrigger as DecisionTrigger | undefined

  // "Không có output" ≠ "chỉ là hội thoại". Một lượt quyết định mà không đọc
  // được gì thì task treo mà người dùng không thấy lý do.
  if (!stdout.trim() && trigger && trigger !== 'chat') {
    await recoverFromBadTurn(ref, trigger, 'decision output unavailable')
    return
  }
  if (!hasDecisionLine(stdout)) return

  const pipeline = await loadPipelineConfig(ref.root, ref.taskId)
  const stepIds = (pipeline.steps || []).map((s: any) => s?.id).filter(Boolean)
  const decision = parseDecision(stdout, stepIds)
  if ('error' in decision) {
    await recoverFromBadTurn(ref, trigger, `invalid decision: ${decision.error}`)
    return
  }

  const at = await readTaskPhase(ref.root, ref.taskId)
  await applyDecision(ref, decision, { gatePending: at.gatePending, completed: !hasPendingStep(at) })
}

/**
 * Giao một lượt cho agent điều phối. Đường vào của nút Run trên node, của
 * "Chạy ngay" lúc tạo task, và của automation `mode: create`.
 */
export async function startOrchestratorTurn(
  root: string,
  projectId: string | null,
  taskId: string,
  trigger: DecisionTrigger = 'manual_start',
): Promise<TurnResult | null> {
  const orch = await resolveOrchestration(root, taskId)
  if (!orch.active) return null
  ensureSweepScheduled()
  const at = await readTaskPhase(root, taskId)
  if (!hasPendingStep(at)) return null
  return askAgent(refOf(root, projectId, taskId), orch, trigger, at.phase, {
    gatePending: at.gatePending,
  })
}

/**
 * Một lượt chat của người dùng với node điều phối. Không đi qua
 * `sendTaskFeedback`: hàm đó chọn "job step xong gần nhất" làm job cha, nên
 * phản hồi rơi vào session của step đầu thay vì session của node.
 */
export async function chatWithOrchestrator(
  root: string,
  projectId: string | null,
  taskId: string,
  message: string,
): Promise<TurnResult> {
  const orch = await resolveOrchestration(root, taskId)
  if (!orch.active) return { error: 'orchestrator is not active for this task', status: 409 }
  const at = await readTaskPhase(root, taskId)
  return askAgent(refOf(root, projectId, taskId), orch, 'chat', at.phase, {
    detail: message,
    gatePending: at.gatePending,
  })
}

/**
 * Cấp lượt điều phối cho bước hiện tại của một task — đường vào dùng cho
 * "Chạy ngay" lúc tạo task và automation `mode: create`.
 *
 * Chưa cấu hình `orchestrator.agent` thì lùi về dispatch tất định, để pipeline
 * vẫn chạy được thay vì đứng ở bước đầu.
 */
export async function dispatchOrchestrator(
  root: string,
  projectId: string | null,
  taskId: string,
  reason: DispatchReason = 'task_created',
): Promise<void> {
  const orch = await resolveOrchestration(root, taskId)
  if (!orch.active) return
  if (orch.agent) {
    await startOrchestratorTurn(root, projectId, taskId)
    return
  }
  const at = await readTaskPhase(root, taskId)
  if (!hasPendingStep(at)) return
  await dispatchStep(refOf(root, projectId, taskId), at.phase, reason)
}

/**
 * Task **có thể** đang được điều phối, đọc từ cờ cache trong `.dev-state`.
 *
 * Cố ý không dùng `collectTasks`: hàm đó quét thêm thư mục artifact và
 * `loadPipelineConfig` cho từng task, tức là áp một vòng I/O mỗi phút lên cả
 * người dùng chưa bao giờ tick checkbox — trong khi cam kết nền của tính năng
 * là "tắt ⇒ chạy y hệt hiện tại". Cờ cache đủ để **lọc**; sự thật vẫn được
 * `resolveOrchestration` xác nhận lại cho từng ứng viên.
 */
async function orchestratedCandidates(root: string): Promise<Record<string, unknown>[]> {
  const stateDir = joinPath(root, '.dev-state')
  let files: string[] = []
  try {
    files = (await readDir(stateDir)).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  const out: Record<string, unknown>[] = []
  for (const file of files) {
    const read = await readState(joinPath(stateDir, file))
    if (!read.ok) continue
    const state = read.state as Record<string, unknown>
    if (state.orchestrator_enabled !== true) continue
    out.push({ ...state, task_id: file.replace(/\.json$/, '') })
  }
  return out
}

/**
 * Nhặt lại task đang đứng: event bus là in-process và không bền (D12), nên một
 * lần restart dashboard đủ làm mất tín hiệu chuyển bước. Đây cũng là chỗ cấy
 * lại đường tự-chữa mà `runTaskStep` vốn có nhưng nay bị guard chặn.
 *
 * Trả về số task đã thấy đang được điều phối — caller dùng nó để quyết định có
 * cần hẹn giờ quét tiếp hay không.
 */
export async function sweepStuckTasks(root: string, projectId: string): Promise<number> {
  let orchestratedSeen = 0
  for (const task of await orchestratedCandidates(root)) {
    const taskId = String(task.task_id)
    const orch = await resolveOrchestration(root, taskId)
    if (!orch.active) continue
    orchestratedSeen++
    if (task.hitl_pending) continue // đang chờ người, không phải treo
    if (task.archived === true) continue
    const phase = String(task.current_phase ?? '')
    if (!phase || phase === 'completed') continue
    if (hasActiveStepJob(root, taskId)) continue
    // Agent đang nghĩ: dispatch tất định lúc này là đè lên lượt của nó.
    if (hasActiveOrchestratorJob(root, taskId)) continue

    const ref: TaskRef = { root, taskId, projectId }
    const last = listJobs(200).find(
      (j) =>
        j.metadata?.taskId === taskId &&
        (!j.metadata?.devTeamRoot || j.metadata.devTeamRoot === root) &&
        j.metadata?.orchestratorJob !== true &&
        !j.applyTarget,
    )

    if (last?.status === 'succeeded' && last.metadata?.pipelineStepId === phase) {
      // Job của bước hiện tại đã xong nhưng cursor chưa đi: `task.advanced` bị
      // mất. Đẩy cursor **tường minh** ở đây — trước kia chỗ này dựa vào khối
      // tự-chữa bên trong `runTaskStep`, thứ nay đã tắt cho lượt dispatch pin.
      const advanced = await advanceStepOnJobSuccess(root, taskId, phase)
      const nextPhase = String(advanced?.state?.current_phase ?? '')
      if (!advanced || advanced.state.hitl_pending) continue // gate vừa mở — chờ người
      if (!nextPhase || nextPhase === 'completed') continue
      await dispatchStep(ref, nextPhase, 'advance')
      continue
    }
    if (!last || last.status === 'cancelled') {
      await dispatchStep(ref, phase, 'sweep_resume')
    }
  }
  return orchestratedSeen
}

async function sweepAllProjects(): Promise<number> {
  let seen = 0
  try {
    for (const project of loadRegistry().projects) {
      try {
        seen += await sweepStuckTasks(project.path, project.id)
      } catch (err) {
        console.warn(`[orchestrator] sweep failed for ${project.id}:`, err)
      }
    }
  } catch (err) {
    console.warn('[orchestrator] sweep failed:', err)
  }
  return seen
}

/**
 * Hẹn giờ quét — chỉ bật khi đã biết chắc có task đang được điều phối.
 *
 * Dashboard không ai bật checkbox thì sau một lượt quét lúc khởi động (readdir
 * `.dev-state` mỗi project) sẽ **không** còn I/O định kỳ nào. `handleEvent` và
 * đường lưu pipeline gọi lại hàm này ngay khi thấy task orchestrated đầu tiên,
 * nên bật checkbox giữa chừng không phải restart dashboard.
 */
export function ensureSweepScheduled(): void {
  if (sweepTimer) return
  sweepTimer = setInterval(() => void sweepAllProjects(), SWEEP_INTERVAL_MS)
  // Không giữ process sống chỉ vì timer quét.
  sweepTimer.unref?.()
}

/** Đăng ký subscriber + hẹn giờ quét. Idempotent (module có thể bị nạp lại trong dev). */
export function startOrchestratorLoop(): void {
  if (loopStarted) return
  loopStarted = true
  on('*', (event) => {
    void handleEvent(event).catch((err) => {
      console.warn('[orchestrator] handleEvent failed:', err)
    })
  })
  void sweepAllProjects().then((seen) => {
    if (seen > 0) ensureSweepScheduled()
  })
}

/** Tests only. */
export function _resetOrchestratorForTest(): void {
  loopStarted = false
  inFlight.clear()
  observations.clear()
  failureAsks.clear()
  turnsAtPhase.clear()
  if (sweepTimer) clearInterval(sweepTimer)
  sweepTimer = null
}
