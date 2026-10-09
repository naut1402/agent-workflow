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
import { listJobs, loadJob, resolveStepRunnerId, submitJob } from '../../runner/business/index.js'
import type { JobRecord } from '../../runner/business/index.js'
import { loadPipelineConfig } from '../../pipeline-editor/business/pipeline/index.js'
import { isRespawnTarget } from '../../monitor/lib/pipelineRunGuards.js'
import { resolveHitlPending, gateStepsFromConfig } from '../../../shared/lib/phase.js'
import { ORCHESTRATOR_STEP_ID, type OrchestratorDecision } from '../schemas/orchestrator.js'
import { stepSummaryOf } from '../../../shared/lib/orchestrator.js'
import { loadKnowledgeBundle } from '../../knowledge/business/index.js'
import { composeStepBrief, renderBundle, type AgentContext, type DispatchReason } from './brief.js'
import {
  buildDecisionPrompt,
  hasDecisionLine,
  parseDecision,
  type DecisionTrigger,
  type StepResult,
} from './decision.js'
import { resolveDecisionRoute } from './mcpRoute.js'
import { mintOrchestratorToken, revokeOrchestratorTokensFor } from './orchestratorTokens.js'

/** Quét lại task treo mỗi 60s — lưới cứu khi event bus (in-process) mất tín hiệu. */
export const SWEEP_INTERVAL_MS = 60_000

const OBSERVATION_LIMIT = 50

const OBSERVED_TASK_LIMIT = 200

const MAX_FAILURE_ASKS = 2

const MAX_TURNS_PER_PHASE = 6

const ACTIONABLE = new Set([
  'job.finished',
  'job.failed',
  'hitl.resolved',
  'task.advanced',
  'orchestrator.start_requested',
])

// xem docs/architecture/events/orchestrator.md
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
  // xem docs/architecture/code/orchestrator.md §6
  observations.delete(key)
  observations.set(key, list)
  while (observations.size > OBSERVED_TASK_LIMIT) {
    const oldest = observations.keys().next().value
    if (oldest === undefined) break
    observations.delete(oldest)
  }
}

function forgetTask(root: string, taskId: string): void {
  const key = keyOf(root, taskId)
  observations.delete(key)
  for (const map of [failureAsks, turnsAtPhase]) {
    for (const k of [...map.keys()]) {
      if (k.startsWith(`${key}::`)) map.delete(k)
    }
  }
}

export function recentOf(root: string, taskId: string, count = 8): string[] {
  return (observations.get(keyOf(root, taskId)) ?? []).slice(-count)
}

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

export function isOrchestratorJob(job: JobRecord | null): boolean {
  return job?.metadata?.orchestratorJob === true
}

function isNonAdvancingTurn(job: JobRecord): boolean {
  const meta = job.metadata ?? {}
  return Boolean(job.applyTarget) || (meta.isChatFeedback === true && meta.orchestratorResume !== true)
}

function isStepJob(job: JobRecord): boolean {
  const meta = job.metadata ?? {}
  return Boolean(meta.pipelineStepId) && meta.orchestratorJob !== true && !isNonAdvancingTurn(job)
}

function isLiveStatus(status: string | undefined): boolean {
  return status === 'queued' || status === 'running' || status === 'awaiting_recovery'
}

// xem docs/architecture/code/orchestrator.md §5
function jobBelongsToTask(job: JobRecord, root: string, taskId: string): boolean {
  const meta = job.metadata ?? {}
  return meta.taskId === taskId && (!meta.devTeamRoot || meta.devTeamRoot === root)
}

export function liveJobsOfTask(root: string, taskId: string): JobRecord[] {
  return listJobs(50).filter((j) => isLiveStatus(j.status) && jobBelongsToTask(j, root, taskId))
}

function hasActiveStepJob(root: string, taskId: string): boolean {
  return liveJobsOfTask(root, taskId).some((j) => !isOrchestratorJob(j))
}

function hasActiveOrchestratorJob(root: string, taskId: string): boolean {
  return liveJobsOfTask(root, taskId).some(isOrchestratorJob)
}

async function readStateRecord(root: string, taskId: string): Promise<Record<string, unknown> | null> {
  const read = await readState(stateFileOf(root, taskId))
  return read.ok ? (read.state as Record<string, unknown>) : null
}

interface TaskPhase {
  phase: string
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

/** Dừng điều phối task, trả quyền chạy tay cho người dùng và phát `orchestrator.halted`. */
export async function haltTask(ref: TaskRef, reason: string): Promise<void> {
  forgetTask(ref.root, ref.taskId)
  let mtime: number
  try {
    mtime = (await stat(stateFileOf(ref.root, ref.taskId))).mtimeMs
  } catch {
    return
  }
  await applyOrchestratorHaltAction(ref.root, ref.taskId, { halted: true, mtime })
  emit('orchestrator.halted', {
    taskId: ref.taskId,
    projectId: ref.projectId || undefined,
    devTeamRoot: ref.root,
    reason,
  })
  revokeOrchestratorTokensFor(ref)
}

/** Start một step qua `runTaskStep`. Lỗi soạn brief hoặc lỗi dispatch (trừ 409) thì halt task. */
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

  // xem docs/architecture/code/orchestrator.md §1
  const { runTaskStep } = await import('../../monitor/business/tasks/runStep.js')
  const result = await runTaskStep(ref.root, ref.projectId || null, ref.taskId, {
    origin: 'orchestrator',
    userPrompt: brief,
    targetStepId: stepId,
    skipIntermediate: true,
  })
  if (result.ok === false) {
    if (result.status === 409) {
      console.warn(`[orchestrator] dispatch deferred for ${ref.taskId}/${stepId}: ${result.error}`)
      return
    }
    await haltTask(ref, `dispatch failed: ${result.error}`)
  }
}

/** Gửi tiếp `message` vào session của step đã chạy. Lỗi thì halt task. */
export async function resumeStep(ref: TaskRef, stepId: string, message: string): Promise<void> {
  emitDispatched(ref, { stepId, action: 'resume', reason: 'resume' })

  const { sendTaskFeedback } = await import('../../runner/business/index.js')
  const result = await sendTaskFeedback(ref.taskId, ref.projectId, message, {
    stepId,
    source: 'orchestrator',
    orchestratorResume: true,
    // xem docs/architecture/code/orchestrator.md §2
    requireStepMatch: true,
  })
  if (result.ok === false) await haltTask(ref, `resume failed: ${result.error}`)
}

/**
 * Chạy một phiên mới cho step đã từng chạy xong, không đổi `current_phase` /
 * `hitl_pending`. Step không hợp lệ hoặc chưa có job xong thì halt task.
 */
export async function respawnStep(
  ref: TaskRef,
  stepId: string,
  agentContext?: AgentContext,
): Promise<void> {
  const pipeline = await loadPipelineConfig(ref.root, ref.taskId)
  const phaseKeys = (pipeline.steps || []).map((s: any) => s?.id).filter(Boolean)
  if (!isRespawnTarget(phaseKeys, stepId)) {
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
      j.metadata?.taskId === ref.taskId &&
      (!j.metadata?.devTeamRoot || j.metadata.devTeamRoot === ref.root) &&
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
      // xem docs/architecture/code/orchestrator.md §2
      respawn: true,
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

  // xem docs/architecture/code/orchestrator.md §3
  const orchestratorToken = mintOrchestratorToken(ref)
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
    sessionMode: 'resume',
    metadata: {
      projectRoot: dirname(ref.root),
      devTeamRoot: ref.root,
      projectId: ref.projectId || undefined,
      taskId: ref.taskId,
      stepId: ORCHESTRATOR_STEP_ID,
      orchestratorJob: true,
      orchestratorTrigger: trigger,
      orchestratorToken,
      orchestratorMcpRoute: mcpRoute,
    },
  })
  return { job }
}

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

// xem docs/architecture/code/orchestrator.md §2
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

async function fallbackDispatch(ref: TaskRef, reason: string): Promise<void> {
  const at = await readTaskPhase(ref.root, ref.taskId)
  if (!hasPendingStep(at) || at.gatePending) return
  emitDispatched(ref, { stepId: at.phase, action: 'start', reason: `agent_fallback: ${reason}` })
  await dispatchStep(ref, at.phase, 'advance')
}

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
    const at = await readTaskPhase(ref.root, ref.taskId)
    if (!hasPendingStep(at) || at.gatePending) return
    await askAgent(ref, orch, 'manual_start', at.phase, { gatePending: at.gatePending })
    return
  }

  if (event.type === 'hitl.resolved') {
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

function pinnedSummaryOf(job: JobRecord | null): string | null {
  const pinned = job?.metadata?.stepSummary
  return typeof pinned === 'string' && pinned.trim() ? pinned.trim() : null
}

/**
 * Kết quả một lượt chạy step cho prompt của agent điều phối: `STEP_SUMMARY` của
 * step nếu có, không thì đuôi output (`fromTail`).
 */
export function stepResultOf(
  job: JobRecord | null,
  stepId: string,
  status: StepResult['status'],
): StepResult {
  // xem docs/architecture/code/orchestrator.md §4
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

/** Điểm vào từ event bus. Không tự đăng ký — `startOrchestratorLoop` đăng ký. */
export async function handleEvent(event: DashboardEvent): Promise<void> {
  // xem docs/architecture/events/orchestrator.md
  if (event.type !== 'orchestrator.start_requested' && String(event.type).startsWith('orchestrator.')) return

  const job = jobOfEvent(event)
  const ref = identifyTask(event, job)
  if (!ref) return
  recordObservation(ref.root, ref.taskId, event)

  // xem docs/architecture/events/orchestrator.md
  if (isOrchestratorJob(job)) {
    if (event.type === 'job.failed') {
      const trigger = job?.metadata?.orchestratorTrigger as DecisionTrigger | undefined
      await recoverFromBadTurn(ref, trigger, 'orchestrator_job_failed')
      revokeOrchestratorTokensFor(ref)
      return
    }
    if (event.type === 'job.finished') {
      await consumeAgentDecision(ref, job as JobRecord)
      revokeOrchestratorTokensFor(ref)
    }
    return
  }

  if (!ACTIONABLE.has(event.type)) return

  const orch = await resolveOrchestration(ref.root, ref.taskId)
  if (!orch.active) return
  ensureSweepScheduled()

  // xem docs/architecture/code/orchestrator.md §5
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

async function consumeAgentDecision(ref: TaskRef, job: JobRecord): Promise<void> {
  // xem docs/architecture/code/orchestrator.md §4
  if (job.metadata?.directDecisionApplied === true) return

  const orch = await resolveOrchestration(ref.root, ref.taskId)
  if (!orch.active) return

  const stdout = stdoutOf(job)
  const trigger = job.metadata?.orchestratorTrigger as DecisionTrigger | undefined

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
 * Giao một lượt cho agent điều phối ở bước hiện tại. `null` khi task không được
 * điều phối hoặc không còn bước nào.
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
 * Một lượt chat của người dùng với node điều phối.
 * xem docs/architecture/code/orchestrator.md §3
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
 * Cấp lượt điều phối cho bước hiện tại của task. Chưa cấu hình
 * `orchestrator.agent` thì dispatch tất định bước hiện tại.
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

// xem docs/architecture/code/orchestrator.md §7
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
 * Nhặt lại task đang được điều phối mà bị đứng. Trả về số task đang được điều
 * phối đã thấy.
 */
export async function sweepStuckTasks(root: string, projectId: string): Promise<number> {
  let orchestratedSeen = 0
  for (const task of await orchestratedCandidates(root)) {
    const taskId = String(task.task_id)
    const orch = await resolveOrchestration(root, taskId)
    if (!orch.active) continue
    orchestratedSeen++
    if (task.hitl_pending) continue
    if (task.archived === true) continue
    const phase = String(task.current_phase ?? '')
    if (!phase || phase === 'completed') continue
    if (hasActiveStepJob(root, taskId)) continue
    if (hasActiveOrchestratorJob(root, taskId)) continue

    const ref: TaskRef = { root, taskId, projectId }
    const last = listJobs(200).find(
      (j) =>
        j.metadata?.taskId === taskId &&
        (!j.metadata?.devTeamRoot || j.metadata.devTeamRoot === root) &&
        j.metadata?.orchestratorJob !== true &&
        j.metadata?.respawn !== true &&
        !j.applyTarget,
    )

    if (last?.status === 'succeeded' && last.metadata?.pipelineStepId === phase) {
      // xem docs/architecture/code/orchestrator.md §7
      const advanced = await advanceStepOnJobSuccess(root, taskId, phase)
      const nextPhase = String(advanced?.state?.current_phase ?? '')
      if (!advanced || advanced.state.hitl_pending) continue
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
 * Hẹn giờ quét task treo; đã có timer thì bỏ qua.
 * xem docs/architecture/code/orchestrator.md §7
 */
export function ensureSweepScheduled(): void {
  if (sweepTimer) return
  sweepTimer = setInterval(() => void sweepAllProjects(), SWEEP_INTERVAL_MS)
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
