/**
 * Vòng lặp điều phối — một subscriber wildcard duy nhất trên event bus.
 *
 * Agent được hỏi ở mọi chuyển tiếp: mốc duy nhất là `job.finished` của một
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
import {
  advanceStepOnJobSuccess,
  hasPendingOrchestratorChat,
  queueOrchestratorChat,
  takeOrchestratorChat,
} from '../../monitor/business/tasks/state.js'
import {
  resolveOrchestration,
  stateFileOf,
  type Orchestration,
} from '../../monitor/business/tasks/startAuthority.js'
import { applyOrchestratorHaltAction } from '../../monitor/business/tasks/state.js'
import { listJobs, loadJob, resolveStepRunnerId, submitJob } from '../../runner/business/index.js'
import type { JobRecord } from '../../runner/business/index.js'
import { loadPipelineConfig } from '../../pipeline-editor/business/pipeline/index.js'
import { isRespawnTarget } from '../../monitor/lib/pipelineRunGuards.js'
import { resolveHitlPending, gateStepsFromConfig } from '../../../shared/lib/phase.js'
import { ORCHESTRATOR_STEP_ID, type OrchestratorDecision, type TaskRef } from '../schemas/orchestrator.js'
import { stepSummaryOf } from '../../../shared/lib/orchestrator.js'
import { loadKnowledgeBundle } from '../../knowledge/business/index.js'
import { composeStepBrief, renderBundle, type AgentContext, type DispatchReason } from './brief.js'
import {
  buildDecisionPrompt,
  hasDecisionLine,
  parseDecision,
  type DecisionTrigger,
  type ParsedDecision,
  type StepResult,
} from './decision.js'
import { resolveDecisionRoute } from './mcpRoute.js'
import { mintOrchestratorToken, revokeOrchestratorTokensFor } from './orchestratorTokens.js'

/** Quét lại task treo mỗi 60s — lưới cứu khi event bus (in-process) mất tín hiệu. */
export const SWEEP_INTERVAL_MS = 60_000

/** Số event gần nhất giữ lại cho mỗi task, làm bối cảnh cho lượt hỏi agent. */
const OBSERVATION_LIMIT = 50

/** Số task giữ ring buffer cùng lúc — dashboard chạy dài có thể thấy hàng nghìn task. */
const OBSERVED_TASK_LIMIT = 200

/**
 * Số lần được hỏi agent vì job lỗi cho mỗi `(task, step)` trước khi dừng hẳn.
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
 * Trigger mà bước kế là tất định — lượt agent hỏng thì chuyển tiếp theo thứ tự
 * pipeline. Với `gate_rejected` / `job_failed` thì không: ở đó không có bước kế
 * nào đúng, đoán bừa là chạy sai mà không ai thấy.
 */
const FALLBACK_TRIGGERS = new Set<DecisionTrigger>(['step_finished', 'manual_start', 'gate_approved'])

const inFlight = new Set<string>()
const observations = new Map<string, string[]>()
const failureAsks = new Map<string, number>()
const turnsAtPhase = new Map<string, number>()

/** Trả về khi nút điều phối đang có job sống — caller dùng để hoãn / xếp hàng. */
const ORCHESTRATOR_BUSY = 'orchestrator busy'

/**
 * Lượt quyết định bị từ chối vì đang có job điều phối khác (D2) — 1 slot/task,
 * chạy lại khi job đó kết thúc (`drainOrchestratorBacklog`). In-memory như
 * `failureAsks`: restart thì mất, lưới an toàn ở `sweepStuckTasks`.
 */
interface DeferredTurn {
  ref: TaskRef
  /** Không bao giờ là `chat` — chat có hàng chờ bền riêng (`pending_orchestrator_chat`). */
  trigger: DecisionTrigger
  currentPhase: string
  extra: TurnInput
}
const deferredTurns = new Map<string, DeferredTurn>()

/**
 * Mức ưu tiên giữ slot — cao hơn thắng; CÙNG mức thì lượt mới nhất thắng (lượt
 * mới mang phase / kết quả step mới hơn, và lượt chạy lại luôn đọc lại state).
 */
const DEFER_RANK: Partial<Record<DecisionTrigger, number>> = {
  job_failed: 3,
  step_finished: 3,
  pipeline_completed: 3,
  gate_approved: 2,
  gate_rejected: 2,
  manual_start: 1,
}

/** Khoá lượt theo task: "guard bận → submit / hoãn / xếp hàng" và drain chạy tuần tự. */
const turnChains = new Map<string, Promise<unknown>>()
let loopStarted = false
let sweepTimer: ReturnType<typeof setInterval> | null = null

function keyOf(root: string, taskId: string): string {
  return `${root}::${taskId}`
}

/**
 * Khoá lượt của một task (cùng pattern với `withStateFileLock`, thêm bước dọn
 * để map không phình). 🚫 Không gọi lồng: hàm chạy trong khoá phải dùng
 * `askAgentAssumingLock`, không gọi `askAgent` / `chatWithOrchestrator` /
 * `drainOrchestratorBacklog` — chờ chính khoá mình là deadlock.
 */
function withTurnLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = turnChains.get(key) ?? Promise.resolve()
  const run = prev.catch(() => {}).then(fn)
  const tail = run.catch(() => {})
  turnChains.set(key, tail)
  void tail.then(() => {
    if (turnChains.get(key) === tail) turnChains.delete(key)
  })
  return run
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
  // Khoá lượt tự dọn; hàng chờ chat trên đĩa bỏ ở lần drain kế nếu nút đã tắt.
  deferredTurns.delete(key)
  for (const map of [failureAsks, turnsAtPhase]) {
    for (const k of [...map.keys()]) {
      if (k.startsWith(`${key}::`)) map.delete(k)
    }
  }
}

export function recentOf(root: string, taskId: string, count = 8): string[] {
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

export function isOrchestratorJob(job: JobRecord | null): boolean {
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

/** Job thuộc task `(root, taskId)`. `devTeamRoot` thiếu ở job cũ — coi như thuộc root đang xét. */
function jobBelongsToTask(job: JobRecord, root: string, taskId: string): boolean {
  const meta = job.metadata ?? {}
  return meta.taskId === taskId && (!meta.devTeamRoot || meta.devTeamRoot === root)
}

export function liveJobsOfTask(root: string, taskId: string): JobRecord[] {
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

export async function readTaskPhase(root: string, taskId: string): Promise<TaskPhase> {
  const state = (await readStateRecord(root, taskId)) ?? {}
  const currentPhase = state.current_phase
  const cfg = await loadPipelineConfig(root, taskId)
  const gate = resolveHitlPending(gateStepsFromConfig(cfg), currentPhase, state.hitl_pending)
  return { phase: String(currentPhase ?? ''), gatePending: gate ? String(gate) : undefined }
}

/** Còn bước để chạy — cursor chưa đi hết pipeline. */
export function hasPendingStep(at: TaskPhase): boolean {
  return Boolean(at.phase) && at.phase !== 'completed'
}

function refOf(root: string, projectId: string | null, taskId: string): TaskRef {
  return { root, taskId, projectId: projectId || projectIdOfRoot(root) }
}

/** Id các step của pipeline — nguồn chung cho mọi chỗ kiểm "step có trong pipeline". */
function stepIdsOf(pipeline: { steps?: unknown[] }): string[] {
  return (pipeline.steps || []).map((s: any) => s?.id).filter(Boolean)
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
 * Báo cho cả hệ thống rằng điều phối của task đã dừng: phát `orchestrator.halted`
 * và thu hồi token điều phối ngay (không đợi job quyết định tự thoát).
 *
 * Dùng chung cho `haltTask` và nút Stop của monitor (cờ halted do caller tự
 * ghi). Cố ý 🚫 KHÔNG `forgetTask`: đường Stop xưa nay không quên ring buffer
 * và bộ đếm lượt của task — dọn bộ nhớ khi Stop là đổi hành vi, cần task riêng.
 */
export function announceHalt(ref: TaskRef, reason: string): void {
  emit('orchestrator.halted', {
    taskId: ref.taskId,
    projectId: ref.projectId || undefined,
    devTeamRoot: ref.root,
    reason,
  })
  revokeOrchestratorTokensFor(ref)
}

/**
 * Dừng điều phối và trả quyền chạy tay cho người dùng: `assertStartAllowed`
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
  announceHalt(ref, reason)
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
 * KHÔNG dùng `resetPipelineStep*`: đường đó lùi con trỏ pipeline và (tuỳ
 * `deleteScope`) xoá artifact của step.
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

/**
 * Chạy một phiên MỚI cho `stepId` bất kỳ đã từng chạy xong (succeeded/failed),
 * KHÔNG qua `runTaskStep` (nên không bị `isRunnableTarget` chặn), KHÔNG đổi
 * `current_phase`/`hitl_pending`. Job được đánh dấu `metadata.respawn: true`
 * để `advancePipelineStepChain` (jobQueue.ts) loại trừ tuyệt đối.
 *
 * `resume` vs `respawn`: `resume` tiêm tiếp (append) vào đúng session cũ;
 * `respawn` luôn `sessionMode:'new'` với brief soạn lại từ đầu qua
 * `composeStepBrief`.
 */
export async function respawnStep(
  ref: TaskRef,
  stepId: string,
  agentContext?: AgentContext,
): Promise<void> {
  const pipeline = await loadPipelineConfig(ref.root, ref.taskId)
  if (!isRespawnTarget(stepIdsOf(pipeline), stepId)) {
    await haltTask(ref, `respawn failed: unknown step ${stepId}`)
    return
  }

  const step = (pipeline.steps || []).find((s: any) => s.id === stepId)
  if (!step?.agent) {
    await haltTask(ref, `respawn failed: step ${stepId} has no agent configured`)
    return
  }

  const hasFinishedJob = listJobs(200).some(
    (j) =>
      jobBelongsToTask(j, ref.root, ref.taskId) &&
      j.metadata?.pipelineStepId === stepId &&
      (j.status === 'succeeded' || j.status === 'failed'),
  )
  if (!hasFinishedJob) {
    await haltTask(ref, `respawn failed: step ${stepId} has no finished job yet`)
    return
  }

  let brief: string
  try {
    brief = await composeStepBrief({
      root: ref.root,
      taskId: ref.taskId,
      stepId,
      reason: 'agent_start',
      agentContext,
    })
  } catch (err: any) {
    await haltTask(ref, `cannot compose brief: ${String(err?.message ?? err)}`)
    return
  }

  emitDispatched(ref, { stepId, action: 'respawn', reason: 'respawn' })

  submitJob({
    // Respawn không có khái niệm "caller chỉ định runner" nên không cần `??`.
    runnerId: resolveStepRunnerId(step).runnerId,
    agentRef: step.agent,
    workspace: joinPath(ref.root, 'tasks', ref.taskId),
    userPrompt: brief,
    produces: Array.isArray(step.produces) ? step.produces : undefined,
    sessionMode: 'new',
    metadata: {
      projectRoot: dirname(ref.root),
      devTeamRoot: ref.root,
      projectId: ref.projectId || undefined,
      taskId: ref.taskId,
      pipelineStepId: stepId,
      // Loại trừ khỏi advancePipelineStepChain — xem jobQueue.ts.
      respawn: true,
      // Vé đi qua lớp chặn đồng bộ của `submitJob` (`assertStartAllowedSync`) —
      // không đi qua `runTaskStep` nên phải tự mang cờ này, giống `runStep.ts:201`,
      // nếu không mọi respawn trên task đang có orchestrator bật (kịch bản duy
      // nhất respawn tồn tại để phục vụ) sẽ bị ném lỗi "orchestrator owns this task".
      orchestratorDispatch: true,
    },
  })
}

/** Dữ liệu thêm cho một lượt hỏi agent, ngoài trigger và phase. */
export interface TurnInput {
  detail?: string
  stepResult?: StepResult
  gatePending?: string
}

export type TurnResult = { job: JobRecord } | { error: string; status: number }

/**
 * Một lượt hỏi agent; bị từ chối vì nút điều phối đang bận thì giữ làm lượt hoãn
 * (trừ `chat`) — lượt đó chạy lại khi job điều phối hiện tại kết thúc.
 */
async function askAgent(
  ref: TaskRef,
  orch: Orchestration,
  trigger: DecisionTrigger,
  currentPhase: string,
  extra: TurnInput = {},
): Promise<TurnResult> {
  return withTurnLock(keyOf(ref.root, ref.taskId), async () => {
    const res = await askAgentAssumingLock(ref, orch, trigger, currentPhase, extra)
    if ('error' in res && res.error === ORCHESTRATOR_BUSY) deferTurn({ ref, trigger, currentPhase, extra })
    return res
  })
}

/** Giữ lượt bị từ chối vì bận vào slot của task, theo `DEFER_RANK`. */
function deferTurn(turn: DeferredTurn): void {
  const rank = DEFER_RANK[turn.trigger]
  if (rank === undefined) return // `chat` (và trigger lạ) không vào slot
  const key = keyOf(turn.ref.root, turn.ref.taskId)
  const held = deferredTurns.get(key)
  if (held && (DEFER_RANK[held.trigger] ?? 0) > rank) return // mức thấp không đè mức cao
  deferredTurns.set(key, turn)
}

/**
 * Thân một lượt hỏi agent — caller PHẢI đang giữ `withTurnLock` của task. Không
 * chặn ở đây: quyết định đọc lại ở `job.finished` của chính job này (vòng lặp tự
 * nhận lại), nên một lượt suy nghĩ dài không giữ khoá `inFlight` của task.
 */
async function askAgentAssumingLock(
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
  // Guard bận PHẢI đứng trước đoạn đếm `turnsAtPhase`: lượt bị hoãn không được
  // đếm, lượt chạy lại của nó đếm đúng một lần.
  if (hasActiveOrchestratorJob(ref.root, ref.taskId)) {
    return { error: ORCHESTRATOR_BUSY, status: 409 }
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

  const stepIds = stepIdsOf(await loadPipelineConfig(ref.root, ref.taskId))

  // Mint NGAY TRƯỚC submitJob: metadata đi vào job lúc submit và không sửa lại
  // được sau (job file là snapshot) — mint muộn hơn nghĩa là job không bao giờ
  // biết token của chính nó.
  const orchestratorToken = mintOrchestratorToken(ref)
  // Chốt tuyến NGAY TRƯỚC submitJob, cùng lý do với mint token: metadata là
  // snapshot không sửa lại được sau. Một giá trị — prompt và runner cùng đọc,
  // nên không có cửa sổ "prompt dạy gọi tool mà job không có tool".
  const { route: mcpRoute } = resolveDecisionRoute()
  const knowledgeBundle = await loadKnowledgeBundle(ref.root, orch.knowledge_inputs ?? [])
  const liveStep = liveJobsOfTask(ref.root, ref.taskId).find((j) => !isOrchestratorJob(j))
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
      activeStep: liveStep
        ? { stepId: (liveStep.metadata?.pipelineStepId as string | undefined) ?? null, status: liveStep.status }
        : null,
      recent: recentOf(ref.root, ref.taskId),
      extraSystemPrompt: orch.system_prompt,
      knowledgeText: renderBundle(knowledgeBundle),
      route: mcpRoute,
    }),
    // Luôn `resume`: ledger khoá entry theo `stepId`, và job này mang
    // `metadata.stepId = ORCHESTRATOR_STEP_ID` ⇒ lượt đầu tự ra `new` (node chưa
    // có entry), lượt sau resume vào ĐÚNG phiên của nó. Guard `hasOwnSession` cũ
    // ở đây chỉ che một triệu chứng của ledger dùng chung một ô session.
    sessionMode: 'resume',
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
      orchestratorToken,
      // Runner đọc lại ĐÚNG giá trị prompt đã dùng để quyết định có gắn MCP của
      // dashboard vào job hay không. Job cũ thiếu khoá này ⇒ `undefined` ⇒
      // `!== 'mcp'` ⇒ không gắn: tương thích ngược hoàn toàn.
      orchestratorMcpRoute: mcpRoute,
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

/**
 * Mỗi hành động một nhánh thi hành. `message` của `resume` đã được schema bắt
 * buộc. `respawn` cố ý không đọc `ctx` (không bị chặn bởi gate/`completed`,
 * khác `start`) — điểm khác biệt cốt lõi so với `applyStart`.
 */
const ACTION_HANDLERS: Record<OrchestratorDecision['action'], DecisionHandler> = {
  halt: (ref, decision) => haltTask(ref, decision.reason || 'agent decided to halt'),
  summary: applySummary,
  resume: (ref, decision) => resumeStep(ref, decision.stepId as string, decision.message as string),
  start: applyStart,
  respawn: (ref, decision) =>
    respawnStep(ref, decision.stepId as string, { summary: decision.summary, context: decision.context }),
}

/** Thi hành quyết định đã parse. Mọi nhánh không hợp lệ đều đã bị chặn trước đó. */
export function applyDecision(
  ref: TaskRef,
  decision: OrchestratorDecision,
  ctx: DecisionOutcomeContext,
): Promise<void> {
  return ACTION_HANDLERS[decision.action](ref, decision, ctx)
}

/**
 * Kiểm một quyết định thô theo pipeline SỐNG của task rồi thi hành ngay — đường
 * chung của `POST /api/orchestrator/decide` (`validateDecision`) và dòng
 * sentinel cuối output (`parseDecision`).
 *
 * Quyết định không hợp lệ ⇒ trả `{ error }`, 🚫 không side effect nào (caller
 * tự quyết: 400 hay lưới tất định). `beforeApply` chạy SAU khi kiểm xong và
 * TRƯỚC khi thi hành — chỗ controller đánh dấu job hiện tại đã áp dụng quyết
 * định (xem `postDecide`).
 */
export async function applyCheckedDecision(
  ref: TaskRef,
  check: (stepIds: string[]) => ParsedDecision,
  beforeApply?: () => void,
): Promise<ParsedDecision> {
  const decision = check(stepIdsOf(await loadPipelineConfig(ref.root, ref.taskId)))
  if ('error' in decision) return decision
  beforeApply?.()
  const at = await readTaskPhase(ref.root, ref.taskId)
  await applyDecision(ref, decision, { gatePending: at.gatePending, completed: !hasPendingStep(at) })
  return decision
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

/** Một nhánh của bảng quyết định — nhận event đã lọc và task nó nói về. */
interface EventEntry {
  handle: (ref: TaskRef, orch: Orchestration, event: DashboardEvent, eventJob?: JobRecord | null) => Promise<void>
  /**
   * Chạy dưới khoá `inFlight` của task. `task.advanced` thì không: nó chỉ dọn
   * dẹp, không dispatch — giữ khoá cho nó là chặn mất lượt `job.finished` mà
   * cùng lần chạy job phát ra ngay sau đó.
   */
  locked: boolean
}

function payloadOf(event: DashboardEvent): Record<string, unknown> {
  return (event.payload ?? {}) as Record<string, unknown>
}

/**
 * Bảng quyết định: event nào khiến orchestrator hành động, và hành động gì.
 * Orchestrator vẫn nghe mọi event và ghi vào ring buffer; chỉ event có trong
 * bảng mới đi tiếp. `job.finished` của một job step là mốc "bước xong" duy nhất
 * mở lượt agent; `task.advanced` chỉ dọn khi pipeline hoàn tất, không tốn lượt
 * LLM; các nhánh còn lại xử lý ngoại lệ.
 *
 * Job của CHÍNH orchestrator không đi qua bảng này — `handleEvent` xử lý nó
 * trước (xem ở đó).
 */
const EVENT_HANDLERS: Record<string, EventEntry> = {
  'task.advanced': {
    locked: false,
    handle: async (ref, _orch, event) => {
      // Lượt tóm tắt cuối do `job.finished` của step cuối lo; ở đây chỉ còn việc
      // phát mốc kết thúc và quên task.
      const currentPhase = String(payloadOf(event).currentPhase ?? '')
      if (!currentPhase || currentPhase === 'completed') {
        emitDispatched(ref, { action: 'idle', reason: 'pipeline completed' })
        forgetTask(ref.root, ref.taskId)
      }
    },
  },

  'job.finished': {
    locked: true,
    handle: async (ref, orch, event, eventJob) => {
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
    },
  },

  'orchestrator.start_requested': {
    locked: true,
    handle: async (ref, orch) => {
      // Automation bị từ chối (409) vì task đang được điều phối — xin một lượt
      // quyết định thay vì tự chạy step.
      const at = await readTaskPhase(ref.root, ref.taskId)
      if (!hasPendingStep(at) || at.gatePending) return
      await askAgent(ref, orch, 'manual_start', at.phase, { gatePending: at.gatePending })
    },
  },

  'hitl.resolved': {
    locked: true,
    handle: async (ref, orch, event) => {
      const payload = payloadOf(event)
      // Gate bị hệ thống tự huỷ vì pipeline đổi hình dạng — không phải quyết định
      // của người, không có gì để điều phối.
      if (payload.reason === 'pipeline_changed') return

      const currentPhase = String(payload.currentPhase ?? '')
      const approved = payload.action === 'approve'
      if (approved && (!currentPhase || currentPhase === 'completed')) return
      await askAgent(ref, orch, approved ? 'gate_approved' : 'gate_rejected', currentPhase, {
        detail: await readFeedbackFile(ref.root, ref.taskId),
      })
    },
  },

  'job.failed': {
    locked: true,
    handle: async (ref, orch, event, eventJob) => {
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
        detail: String(payloadOf(event).error ?? job?.error ?? ''),
        stepResult: stepResultOf(job, stepId, 'failed'),
      })
    },
  },
}

/** Nhánh của một loại event — chỉ khoá RIÊNG của bảng, 🚫 không lọt khoá prototype (`constructor`, …). */
function eventEntryOf(type: string): EventEntry | undefined {
  return Object.hasOwn(EVENT_HANDLERS, type) ? EVENT_HANDLERS[type] : undefined
}

function stdoutOf(job: JobRecord | null): string {
  return typeof job?.stdout === 'string' ? job.stdout : ''
}

/**
 * Tóm tắt do `runJob` chốt sẵn từ `result.stdout` ĐẦY ĐỦ, trước cả
 * `shouldPersistStdout` lẫn `CHAT_STDOUT_LIMIT` — xem `jobQueue.captureStepSummary`.
 * Đây là đường chính; đọc lại từ `job.stdout` chỉ là lưới cho job ghi trước fix.
 */
function pinnedSummaryOf(job: JobRecord | null): string | null {
  const pinned = job?.metadata?.stepSummary
  return typeof pinned === 'string' && pinned.trim() ? pinned.trim() : null
}

/**
 * Kết quả một lượt chạy step, gói lại cho prompt của agent điều phối.
 *
 * Cố ý KHÔNG mang stdout thô: context làm việc của nút con phải ở lại phiên của
 * nút con. Cha nhận `STEP_SUMMARY` do chính con soạn, và chỉ khi không có mới
 * rơi về đuôi output (`fromTail`) — chi tiết đầy đủ nằm ở artifact.
 *
 * Export thuần để test gọi thẳng, cùng quy ước với `identifyTask` /
 * `isOrchestratorJob`: đây là hợp đồng con → cha, phải đo được không cần bus.
 */
export function stepResultOf(
  job: JobRecord | null,
  stepId: string,
  status: StepResult['status'],
): StepResult {
  // `job.stdout` ĐÃ được provider bóc khỏi khung JSON (`parse-json` làm việc đó
  // ở `providers/AbstractAgentCliProvider.ts`), nên ở đây nó luôn là text thuần. Bóc lần
  // thứ hai từng rơi vào nhánh "cắt từ `{` đầu tới `}` cuối" và vứt mất chính
  // dòng `STEP_SUMMARY` thật khi nút con có in một khối JSON trong câu trả lời.
  const text = stdoutOf(job)
  const summary = pinnedSummaryOf(job) ?? stepSummaryOf(text)
  return {
    stepId,
    status,
    artifacts: job?.artifactsFound ?? [],
    result: summary ?? text,
    fromTail: !summary,
  }
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
  //
  // Drain việc treo (lượt hoãn / tin nhắn chờ) chạy SAU `revokeOrchestratorTokensFor`:
  // hàm đó thu hồi MỌI token của task, chạy trước thì token vừa mint cho job mới
  // cũng mất. Job bị `cancelJob` chỉ phát `job.cancelled` (không vào đây) — việc
  // treo khi đó do `sweepStuckTasks` nhặt ở chu kỳ kế.
  if (isOrchestratorJob(job)) {
    if (event.type === 'job.failed') {
      const trigger = job?.metadata?.orchestratorTrigger as DecisionTrigger | undefined
      await recoverFromBadTurn(ref, trigger, 'orchestrator_job_failed')
      revokeOrchestratorTokensFor(ref)
      await drainOrchestratorBacklog(ref)
      return
    }
    if (event.type === 'job.finished') {
      await consumeAgentDecision(ref, job as JobRecord)
      revokeOrchestratorTokensFor(ref)
      await drainOrchestratorBacklog(ref)
    }
    return
  }

  // Bảng quyết định cũng là danh sách event khiến orchestrator hành động.
  const entry = eventEntryOf(event.type)
  if (!entry) return

  const orch = await resolveOrchestration(ref.root, ref.taskId)
  if (!orch.active) return
  // Đã thấy một task đang được điều phối ⇒ từ giờ mới cần quét định kỳ.
  ensureSweepScheduled()

  if (!entry.locked) {
    await entry.handle(ref, orch, event, job)
    return
  }

  const key = keyOf(ref.root, ref.taskId)
  if (inFlight.has(key)) return
  inFlight.add(key)
  try {
    await entry.handle(ref, orch, event, job)
  } finally {
    inFlight.delete(key)
  }
}

/**
 * Đọc quyết định từ output của job orchestrator.
 *
 * Output không có dòng sentinel ⇒ đây chỉ là một lượt hội thoại (người dùng
 * chat với node), không làm gì. Có sentinel nhưng hỏng ⇒ lưới tất định.
 */
async function consumeAgentDecision(ref: TaskRef, job: JobRecord): Promise<void> {
  // G4 — agent đã thi hành quyết định qua `POST /api/orchestrator/decide` giữa
  // lượt; đọc lại sentinel cuối output ở đây sẽ áp dụng quyết định đó LẦN NỮA.
  if (job.metadata?.directDecisionApplied === true) return

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

  const decision = await applyCheckedDecision(ref, (stepIds) => parseDecision(stdout, stepIds))
  if ('error' in decision) await recoverFromBadTurn(ref, trigger, `invalid decision: ${decision.error}`)
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

/** Kết quả một lượt chat: job vừa submit, lỗi, hoặc đã xếp hàng chờ nút điều phối rảnh. */
export type ChatTurnResult = TurnResult | { queued: true }

/**
 * Một lượt chat của người dùng với node điều phối. Không đi qua
 * `sendTaskFeedback`: hàm đó chọn "job step xong gần nhất" làm job cha, nên
 * phản hồi rơi vào session của step đầu thay vì session của node.
 *
 * Nút đang bận (một lượt khác của chính nó còn sống) ⇒ xếp hàng vào
 * `pending_orchestrator_chat`; `drainOrchestratorBacklog` gửi khi job đó kết thúc.
 */
export async function chatWithOrchestrator(
  root: string,
  projectId: string | null,
  taskId: string,
  message: string,
): Promise<ChatTurnResult> {
  const orch = await resolveOrchestration(root, taskId)
  if (!orch.active) return { error: 'orchestrator is not active for this task', status: 409 }
  const ref = refOf(root, projectId, taskId)
  return withTurnLock(keyOf(root, taskId), async () => {
    // Đọc phase TRONG khoá để lượt chat dùng cursor mới nhất.
    const at = await readTaskPhase(root, taskId)
    const res = await askAgentAssumingLock(ref, orch, 'chat', at.phase, {
      detail: message,
      gatePending: at.gatePending,
    })
    if (!('error' in res) || res.error !== ORCHESTRATOR_BUSY) return res
    // Luôn xếp hàng, bỏ qua `mode: 'immediate'` của panel (G9.9).
    const queued = await queueOrchestratorChat(root, taskId, [message])
    return queued ? { queued: true as const } : res
  })
}

/**
 * Chạy lại một lượt hoãn với state hiện tại (D2). `null` ⇒ lượt đó không còn
 * hợp lệ (vd `manual_start` mà gate đã mở) — caller rơi xuống tin nhắn chờ.
 */
async function replayDeferredTurn(
  ref: TaskRef,
  orch: Orchestration,
  held: DeferredTurn,
): Promise<TurnResult | null> {
  const at = await readTaskPhase(ref.root, ref.taskId)
  switch (held.trigger) {
    case 'step_finished':
    case 'pipeline_completed':
      return askAgentAssumingLock(
        ref,
        orch,
        hasPendingStep(at) ? 'step_finished' : 'pipeline_completed',
        at.phase,
        { stepResult: held.extra.stepResult, gatePending: at.gatePending },
      )
    case 'manual_start':
      // Cùng điều kiện với handler `orchestrator.start_requested`.
      if (!hasPendingStep(at) || at.gatePending) return null
      return askAgentAssumingLock(ref, orch, 'manual_start', at.phase, { gatePending: at.gatePending })
    case 'gate_approved':
    case 'gate_rejected':
      return askAgentAssumingLock(ref, orch, held.trigger, held.currentPhase, {
        detail: held.extra.detail,
        gatePending: at.gatePending,
      })
    case 'job_failed':
      // `failureAsks` đã đếm ở handler `job.failed` — lượt chạy lại không đi lại handler.
      return askAgentAssumingLock(ref, orch, 'job_failed', held.currentPhase, {
        detail: held.extra.detail,
        stepResult: held.extra.stepResult,
      })
    default:
      return null
  }
}

/** Nút tắt / halted: bỏ việc treo, giống `resubmitPendingFeedback` bỏ mục `gate` (G9.7). */
async function dropOrchestratorBacklog(ref: TaskRef): Promise<void> {
  deferredTurns.delete(keyOf(ref.root, ref.taskId))
  await takeOrchestratorChat(ref.root, ref.taskId)
}

/**
 * Chạy phần việc còn treo của nút điều phối khi nó rảnh: lượt hoãn trước (D6),
 * nếu không có thì gộp tin nhắn chờ thành một lượt `chat` (D5). Mỗi lần chỉ
 * submit tối đa MỘT job; phần còn lại chờ `job.finished` của job đó gọi lại.
 *
 * Export để sweep và test gọi thẳng. 🚫 Không gọi từ trong `withTurnLock`.
 */
export async function drainOrchestratorBacklog(ref: TaskRef): Promise<void> {
  const key = keyOf(ref.root, ref.taskId)
  await withTurnLock(key, async () => {
    if (hasActiveOrchestratorJob(ref.root, ref.taskId)) return // job đó xong sẽ gọi lại
    let orch = await resolveOrchestration(ref.root, ref.taskId)
    if (!orch.active) return dropOrchestratorBacklog(ref)

    const held = deferredTurns.get(key)
    if (held) {
      deferredTurns.delete(key)
      const res = await replayDeferredTurn(ref, orch, held)
      if (res && 'job' in res) return // D6: tin nhắn chờ đợi job này xong
      if (res && 'error' in res && res.error === ORCHESTRATOR_BUSY) {
        deferTurn(held)
        return
      }
      // Lượt hoãn không còn hợp lệ ⇒ rơi xuống tin nhắn chờ. Lượt lỗi có thể đã
      // halt task (vd vòng lượt) — đọc lại trước khi gửi tiếp.
      if (res) {
        orch = await resolveOrchestration(ref.root, ref.taskId)
        if (!orch.active) return dropOrchestratorBacklog(ref)
      }
    }

    const messages = await takeOrchestratorChat(ref.root, ref.taskId)
    if (!messages.length) return
    const at = await readTaskPhase(ref.root, ref.taskId)
    const res = await askAgentAssumingLock(ref, orch, 'chat', at.phase, {
      detail: messages.join('\n\n'),
      gatePending: at.gatePending,
    })
    if (!('error' in res)) return
    if (res.error === ORCHESTRATOR_BUSY) {
      await queueOrchestratorChat(ref.root, ref.taskId, messages, { prepend: true })
    } else {
      console.warn(`[orchestrator] queued chat dropped for ${ref.taskId}: ${res.error}`)
    }
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
 * Task có thể đang được điều phối, đọc từ cờ cache trong `.dev-state`.
 *
 * Cố ý không dùng `collectTasks`: hàm đó quét thêm thư mục artifact và
 * `loadPipelineConfig` cho từng task, tức là áp một vòng I/O mỗi phút lên cả
 * người dùng chưa bao giờ tick checkbox — trong khi cam kết nền của tính năng
 * là "tắt ⇒ chạy y hệt hiện tại". Cờ cache đủ để lọc; sự thật vẫn được
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
    const ref: TaskRef = { root, taskId, projectId }
    // Việc treo của nút điều phối (tin nhắn chờ bền qua restart, lượt hoãn mà
    // `job.finished` không gọi lại được — vd job bị `cancelJob`). Hợp lệ cả khi
    // đang chờ gate hoặc step đang chạy, nên phải đứng TRƯỚC các `continue` dưới (G9.6).
    if (hasPendingOrchestratorChat(task) || deferredTurns.has(keyOf(root, taskId))) {
      if (!hasActiveOrchestratorJob(root, taskId)) await drainOrchestratorBacklog(ref)
      continue
    }
    if (task.hitl_pending) continue // đang chờ người, không phải treo
    if (task.archived === true) continue
    const phase = String(task.current_phase ?? '')
    if (!phase || phase === 'completed') continue
    if (hasActiveStepJob(root, taskId)) continue
    // Agent đang nghĩ: dispatch tất định lúc này là đè lên lượt của nó.
    if (hasActiveOrchestratorJob(root, taskId)) continue

    const last = listJobs(200).find(
      (j) =>
        jobBelongsToTask(j, root, taskId) &&
        j.metadata?.orchestratorJob !== true &&
        j.metadata?.respawn !== true &&
        !j.applyTarget,
    )

    if (last?.status === 'succeeded' && last.metadata?.pipelineStepId === phase) {
      // Job của bước hiện tại đã xong nhưng cursor chưa đi (`task.advanced` bị
      // mất) — đẩy cursor tường minh ở đây vì `runTaskStep` không tự-chữa việc
      // này cho lượt dispatch pin.
      const advanced = await advanceStepOnJobSuccess(root, taskId, phase)
      const nextPhase = String(advanced?.state?.current_phase ?? '')
      if (!advanced || advanced.state.hitl_pending) continue // gate vừa mở — chờ người
      if (!nextPhase || nextPhase === 'completed') continue
      await dispatchStep(ref, nextPhase, 'advance')
      continue
    }
    if (!last || last.status === 'cancelled') {
      await dispatchStep(ref, phase, 'sweep_resume')
      continue
    }

    // Lưới an toàn D2: step do điều phối chạy đã xong nhưng không có lượt quyết
    // định nào sau đó (lượt hoãn mất vì restart).
    if (orch.agent && needsStepFinishedTurn(root, taskId, last, phase)) {
      const stepId = String(last.metadata?.pipelineStepId ?? '')
      const at = await readTaskPhase(root, taskId)
      await askAgent(ref, orch, hasPendingStep(at) ? 'step_finished' : 'pipeline_completed', at.phase, {
        stepResult: stepResultOf(last, stepId, 'succeeded'),
        gatePending: at.gatePending,
      })
    }
  }
  return orchestratedSeen
}

/**
 * Step do chính nút điều phối chạy đã `succeeded`, cursor đã sang bước kế, mà
 * chưa có lượt quyết định nào được mở sau khi nó xong. Step chạy tay
 * (không `orchestratorDispatch` / `orchestratorResume`) bị loại: bật điều phối
 * cho một task đang nghỉ không được tự mở lượt và chạy tiếp pipeline.
 */
function needsStepFinishedTurn(root: string, taskId: string, last: JobRecord, phase: string): boolean {
  const meta = last.metadata ?? {}
  if (last.status !== 'succeeded' || !isStepJob(last)) return false
  if (meta.pipelineStepId === phase) return false // nhánh advance ở trên lo
  if (meta.orchestratorDispatch !== true && meta.orchestratorResume !== true) return false
  // Handler `job.finished` của step còn đang chạy — lượt của nó sắp được mở.
  if (inFlight.has(keyOf(root, taskId))) return false
  const finishedAt = last.finishedAt ?? ''
  return !listJobs(200).some(
    (j) => isOrchestratorJob(j) && jobBelongsToTask(j, root, taskId) && (j.createdAt ?? '') > finishedAt,
  )
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
 * `.dev-state` mỗi project) sẽ không còn I/O định kỳ nào. `handleEvent` và
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
  deferredTurns.clear()
  turnChains.clear()
  if (sweepTimer) clearInterval(sweepTimer)
  sweepTimer = null
}
