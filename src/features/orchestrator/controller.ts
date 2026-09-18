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

/** Header riêng cho token của orchestrator — KHÔNG dùng `Authorization`, tránh
 * `createJwtMiddleware()` (đọc `Authorization` cho JWT dashboard) chặn nhầm.
 * Tên header case-insensitive theo chuẩn HTTP — phải khớp giá trị được
 * `claude-code-cli.ts` cấp vào env `DASHBOARD_ORCHESTRATOR_TOKEN` cho tiến
 * trình con, và giá trị agent tự đọc lại khi chạy `curl`. */
export const ORCHESTRATOR_TOKEN_HEADER = 'X-Dashboard-Orchestrator-Token'

/**
 * Job orchestrator đang chạy CỦA ĐÚNG `ref` — tự soi lại `devTeamRoot` (G3 +
 * `resolveTaskJobId` không lọc theo root, chỉ so `taskId`).
 */
function currentOrchestratorJobId(ref: TaskRef): string | null {
  const jobId = resolveTaskJobId(ref.taskId)
  if (!jobId) return null
  const job = loadJob(jobId)
  if (!job || job.metadata?.devTeamRoot !== ref.root || job.metadata?.orchestratorJob !== true) return null
  return jobId
}

/**
 * API REST cho orchestrator gọi ngược vào chính server này giữa lượt (§3.1/§4.2
 * design.md, bản v2 — KHÔNG phải MCP). Xác thực bằng token 1-lần/1-job
 * (`orchestratorTokens.ts`), không phải JWT dashboard. Agent gọi 3 route này
 * bằng shell command (`curl`) — hướng dẫn nằm trong `buildDecisionPrompt`.
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
    // Job thuộc root khác (taskId trùng tên giữa 2 project) — không lộ output chéo task (G3).
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

    // Đánh dấu TRƯỚC KHI thi hành: `applyDecision` (action `start`) tạo ngay một
    // job step mới, và `resolveTaskJobId` ưu tiên job MỚI NHẤT — đánh dấu sau sẽ
    // vô tình gắn cờ lên job step đó thay vì job orchestrator đang gọi API này
    // (chống double-dispatch với sentinel cuối output).
    const currentJobId = currentOrchestratorJobId(ref)
    if (currentJobId) markDirectDecisionApplied(currentJobId)

    const at = await readTaskPhase(ref.root, ref.taskId)
    await applyDecision(ref, decision, { gatePending: at.gatePending, completed: !hasPendingStep(at) })
    return this.json(200, { applied: decision.action })
  }
}
