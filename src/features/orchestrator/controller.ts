import { AbstractController } from '../../backend/http/AbstractController.js'
import { loadJob, markDirectDecisionApplied } from '../runner/business/index.js'
import { readJobLogDelta, resolveTaskJobId } from '../logs/business/index.js'
import { loadPipelineConfig } from '../pipeline-editor/business/pipeline/index.js'
import { validateDecision } from './business/decision.js'
import {
  applyDecision,
  hasPendingStep,
  isOrchestratorJob,
  liveJobsOfTask,
  readTaskPhase,
  recentOf,
  type TaskRef,
} from './business/decisionLoop.js'
import { resolveOrchestratorToken } from './business/orchestratorTokens.js'

/**
 * Header mang token của orchestrator cho API gọi ngược.
 * xem docs/architecture/code/orchestrator.md §8
 */
export const ORCHESTRATOR_TOKEN_HEADER = 'X-Dashboard-Orchestrator-Token'

// xem docs/architecture/code/orchestrator.md §8
function currentOrchestratorJobId(ref: TaskRef): string | null {
  const jobId = resolveTaskJobId(ref.taskId)
  if (!jobId) return null
  const job = loadJob(jobId)
  if (!job || job.metadata?.devTeamRoot !== ref.root || job.metadata?.orchestratorJob !== true) return null
  return jobId
}

/**
 * API REST cho orchestrator gọi ngược vào server giữa lượt, xác thực bằng token
 * theo job (`orchestratorTokens.ts`).
 */
export class OrchestratorController extends AbstractController {
  private resolveRef(): TaskRef | null {
    const token = this.c.req.header(ORCHESTRATOR_TOKEN_HEADER)
    return token ? resolveOrchestratorToken(token) : null
  }

  /** `GET /api/orchestrator/status` — trạng thái thật của task đang điều phối. */
  async getStatus(): Promise<Response> {
    const ref = this.resolveRef()
    if (!ref) return this.json(401, { error: 'invalid or expired orchestrator token' })

    const at = await readTaskPhase(ref.root, ref.taskId)
    const live = liveJobsOfTask(ref.root, ref.taskId).find((j) => !isOrchestratorJob(j))
    return this.json(200, {
      currentPhase: at.phase,
      gatePending: at.gatePending ?? null,
      activeStep: live
        ? { stepId: live.metadata?.pipelineStepId ?? null, status: live.status, jobId: live.id }
        : null,
      recent: recentOf(ref.root, ref.taskId),
    })
  }

  /** `GET /api/orchestrator/output?offset=N` — output hiện tại của step đang/đã chạy, không cần chờ job kết thúc. */
  async getOutput(): Promise<Response> {
    const ref = this.resolveRef()
    if (!ref) return this.json(401, { error: 'invalid or expired orchestrator token' })

    const offset = Number(this.c.req.query('offset') ?? 0)
    const jobId = resolveTaskJobId(ref.taskId)
    const job = jobId ? loadJob(jobId) : null
    // xem docs/architecture/code/orchestrator.md §8
    if (!job || job.metadata?.devTeamRoot !== ref.root) return this.json(200, { text: '', eof: true })
    const delta = await readJobLogDelta(jobId as string, { offset: Number.isFinite(offset) ? offset : 0, waitMs: 0 })
    return this.json(200, delta)
  }

  /** `POST /api/orchestrator/decide` — start/resume/halt/summary, có hiệu lực ngay. */
  async postDecide(): Promise<Response> {
    const ref = this.resolveRef()
    if (!ref) return this.json(401, { error: 'invalid or expired orchestrator token' })

    const body = await this.parseBody()
    if (!body.ok) return this.json(400, { error: 'invalid JSON' })

    const pipeline = await loadPipelineConfig(ref.root, ref.taskId)
    const stepIds = (pipeline.steps || []).map((s: any) => s?.id).filter(Boolean)
    const decision = validateDecision(body.value, stepIds)
    if ('error' in decision) return this.json(400, { error: decision.error })

    // xem docs/architecture/code/orchestrator.md §4
    const currentJobId = currentOrchestratorJobId(ref)
    if (currentJobId) markDirectDecisionApplied(currentJobId)

    const at = await readTaskPhase(ref.root, ref.taskId)
    await applyDecision(ref, decision, { gatePending: at.gatePending, completed: !hasPendingStep(at) })
    return this.json(200, { applied: decision.action })
  }
}
