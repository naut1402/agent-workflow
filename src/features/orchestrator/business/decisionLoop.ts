/**
 * Vòng lặp điều phối — một subscriber wildcard duy nhất trên event bus.
 *
 * Ranh giới **tất định vs LLM** là điều kiện để tính năng này không đắt hơn
 * pipeline cũ (§3 của design):
 * - Tất định (0 lượt LLM): chuyển tiếp tuyến tính, review-retry, approve gate,
 *   soạn brief, quét task treo.
 * - Gọi agent: gate bị **reject**, job **failed**, và **chat** của người dùng.
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
import { composeStepBrief, type DispatchReason } from './brief.js'
import { buildDecisionPrompt, hasDecisionLine, parseDecision, type DecisionTrigger } from './decision.js'

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
 * Event khiến orchestrator **hành động**. Nó vẫn *nghe* mọi event (kể cả lỗi)
 * và ghi vào ring buffer; `hitl.pending` cố ý không nằm đây — gate đang chờ
 * người, không phải chờ orchestrator.
 */
const ACTIONABLE = new Set(['task.advanced', 'hitl.resolved', 'job.failed'])

const inFlight = new Set<string>()
const observations = new Map<string, string[]>()
const failureAsks = new Map<string, number>()
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
  for (const k of [...failureAsks.keys()]) {
    if (k.startsWith(`${key}::`)) failureAsks.delete(k)
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

/** Job đang sống của task — bỏ qua job quyết định của chính orchestrator. */
function hasActiveStepJob(root: string, taskId: string): boolean {
  return listJobs(50).some(
    (j) =>
      j.metadata?.taskId === taskId &&
      (!j.metadata?.devTeamRoot || j.metadata.devTeamRoot === root) &&
      j.metadata?.orchestratorJob !== true &&
      (j.status === 'queued' || j.status === 'running' || j.status === 'awaiting_recovery'),
  )
}

/* ── Hành động ──────────────────────────────────────────────────────────── */

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
): Promise<void> {
  let brief: string
  try {
    brief = await composeStepBrief({ root: ref.root, taskId: ref.taskId, stepId, reason, detail })
  } catch (err: any) {
    await haltTask(ref, `cannot compose brief: ${String(err?.message ?? err)}`)
    return
  }

  emit('orchestrator.dispatched', {
    taskId: ref.taskId,
    projectId: ref.projectId || undefined,
    devTeamRoot: ref.root,
    stepId,
    action: 'start',
    reason,
  })

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
  emit('orchestrator.dispatched', {
    taskId: ref.taskId,
    projectId: ref.projectId || undefined,
    devTeamRoot: ref.root,
    stepId,
    action: 'resume',
    reason: 'resume',
  })

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
 * Một lượt hỏi agent. Không chặn ở đây: quyết định đọc lại ở `job.finished` của
 * chính job này (vòng lặp tự nhận lại), nên một lượt suy nghĩ dài không giữ
 * khoá `inFlight` của task.
 */
async function askAgent(
  ref: TaskRef,
  orch: Orchestration,
  trigger: DecisionTrigger,
  currentPhase: string,
  detail?: string,
): Promise<void> {
  if (!orch.agent) {
    await haltTask(ref, 'orchestrator.agent is not configured')
    return
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

  submitJob({
    agentRef: orch.agent,
    workspace: joinPath(ref.root, 'tasks', ref.taskId),
    userPrompt: buildDecisionPrompt({
      taskId: ref.taskId,
      currentPhase,
      stepIds,
      trigger,
      detail,
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
      // quyết định là sự cố phải halt, ở lượt chat thì chỉ là im lặng.
      orchestratorTrigger: trigger,
    },
  })
}

/** Thi hành quyết định đã parse. Mọi nhánh không hợp lệ đều đã bị chặn trước đó. */
async function applyDecision(ref: TaskRef, decision: OrchestratorDecision): Promise<void> {
  if (decision.action === 'halt') {
    await haltTask(ref, decision.reason || 'agent decided to halt')
    return
  }
  if (decision.action === 'resume') {
    // `message` đã được schema bắt buộc — không có thì `parseDecision` đã halt.
    await resumeStep(ref, decision.stepId as string, decision.message as string)
    return
  }
  await dispatchStep(ref, decision.stepId as string, 'agent_start', decision.message)
}

/* ── Bảng quyết định ────────────────────────────────────────────────────── */

async function readFeedbackFile(root: string, taskId: string): Promise<string> {
  try {
    return await readTextFile(joinPath(root, 'tasks', taskId, 'hitl-feedback.md'))
  } catch {
    return ''
  }
}

/**
 * Quyết định cho một event đã lọc. Xem bảng §4.2.4 của design — cột "Agent?"
 * là nơi duy nhất tốn lượt LLM.
 */
export async function decide(
  ref: TaskRef,
  orch: Orchestration,
  event: DashboardEvent,
  eventJob?: JobRecord | null,
): Promise<void> {
  const payload = (event.payload ?? {}) as Record<string, unknown>

  if (event.type === 'task.advanced') {
    const currentPhase = String(payload.currentPhase ?? '')
    if (!currentPhase || currentPhase === 'completed') {
      emit('orchestrator.dispatched', {
        taskId: ref.taskId,
        projectId: ref.projectId || undefined,
        devTeamRoot: ref.root,
        action: 'idle',
        reason: 'pipeline completed',
      })
      forgetTask(ref.root, ref.taskId)
      return
    }
    // Pipeline tiến được một bước ⇒ chuỗi lỗi (nếu có) đã được gỡ.
    failureAsks.delete(`${keyOf(ref.root, ref.taskId)}::${currentPhase}`)
    const reason: DispatchReason = payload.reason === 'review_retry' ? 'review_retry' : 'advance'
    const detail =
      reason === 'review_retry' ? await readReviewVerdict(ref.root, ref.taskId) : undefined
    await dispatchStep(ref, currentPhase, reason, detail)
    return
  }

  if (event.type === 'hitl.resolved') {
    // Gate bị hệ thống tự huỷ vì pipeline đổi hình dạng — không phải quyết định
    // của người, không có gì để điều phối.
    if (payload.reason === 'pipeline_changed') return

    const currentPhase = String(payload.currentPhase ?? '')
    if (payload.action === 'approve') {
      if (!currentPhase || currentPhase === 'completed') return
      await dispatchStep(ref, currentPhase, 'gate_approved')
      return
    }
    // Reject: cần phán đoán — resume step cũ, chạy step khác, hay dừng hẳn.
    await askAgent(
      ref,
      orch,
      'gate_rejected',
      currentPhase,
      await readFeedbackFile(ref.root, ref.taskId),
    )
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
    await askAgent(ref, orch, 'job_failed', stepId, String(payload.error ?? job?.error ?? ''))
  }
}

/** Verdict của reviewer — nội dung cần chuyển cho step được chạy lại. */
async function readReviewVerdict(root: string, taskId: string): Promise<string | undefined> {
  try {
    return await readTextFile(joinPath(root, 'tasks', taskId, 'review.md'))
  } catch {
    return undefined
  }
}

/* ── Subscriber ─────────────────────────────────────────────────────────── */

/**
 * Điểm vào duy nhất từ event bus. Export thuần (không tự đăng ký) để test gọi
 * thẳng — đăng ký thật nằm ở `startOrchestratorLoop`.
 */
export async function handleEvent(event: DashboardEvent): Promise<void> {
  // Chống tự-kích: mọi thứ orchestrator phát ra đều không được quay lại nó.
  if (String(event.type).startsWith('orchestrator.')) return

  // Một lần `loadJob` cho cả `identifyTask` lẫn các nhánh bên dưới — hàm này
  // chạy trên MỌI event của bus, nên mỗi lần đọc đĩa thừa là thừa toàn cục.
  const job = jobOfEvent(event)
  const ref = identifyTask(event, job)
  if (!ref) return
  recordObservation(ref.root, ref.taskId, event)

  // Job quyết định của chính orchestrator: đây là chỗ đọc kết quả một lượt hỏi.
  if (isOrchestratorJob(job)) {
    if (event.type === 'job.failed') {
      // Không tự gọi lại chính mình — đó là cách sinh bão job.
      await haltTask(ref, 'orchestrator_job_failed')
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
 * chat với node), không làm gì. Có sentinel nhưng hỏng ⇒ halt tường minh.
 */
async function consumeAgentDecision(ref: TaskRef, job: JobRecord): Promise<void> {
  const orch = await resolveOrchestration(ref.root, ref.taskId)
  if (!orch.active) return

  const stdout = typeof job.stdout === 'string' ? job.stdout : ''
  const trigger = job.metadata?.orchestratorTrigger

  // "Không có output" ≠ "chỉ là hội thoại". Một lượt quyết định mà không đọc
  // được gì là đúng kết cục D1 muốn tránh: không dispatch, không halt, không
  // event — task treo mà người dùng không thấy lý do.
  if (!stdout.trim() && trigger && trigger !== 'chat') {
    await haltTask(ref, 'decision output unavailable')
    return
  }
  if (!hasDecisionLine(stdout)) return

  const pipeline = await loadPipelineConfig(ref.root, ref.taskId)
  const stepIds = (pipeline.steps || []).map((s: any) => s?.id).filter(Boolean)
  const decision = parseDecision(stdout, stepIds)
  if ('error' in decision) {
    await haltTask(ref, `invalid decision: ${decision.error}`)
    return
  }
  await applyDecision(ref, decision)
}

/**
 * Cấp brief + start bước hiện tại của một task — đường vào tất định dùng cho
 * "Chạy ngay" lúc tạo task và automation `mode: create`.
 */
export async function dispatchOrchestrator(
  root: string,
  projectId: string | null,
  taskId: string,
  reason: DispatchReason = 'task_created',
): Promise<void> {
  const orch = await resolveOrchestration(root, taskId)
  if (!orch.active) return
  const read = await readState(stateFileOf(root, taskId))
  if (!read.ok) return
  const stepId = String((read.state as Record<string, unknown>).current_phase ?? '')
  if (!stepId || stepId === 'completed') return
  await dispatchStep({ root, taskId, projectId: projectId || projectIdOfRoot(root) }, stepId, reason)
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
 * `.dev-state` mỗi project) sẽ **không** còn I/O định kỳ nào. `handleEvent` gọi
 * lại hàm này ngay khi thấy task orchestrated đầu tiên, nên bật checkbox giữa
 * chừng không phải restart dashboard.
 */
function ensureSweepScheduled(): void {
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
  if (sweepTimer) clearInterval(sweepTimer)
  sweepTimer = null
}
