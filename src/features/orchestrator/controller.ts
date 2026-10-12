import { AbstractController } from '../../backend/http/AbstractController.js'
import { listJobs, markDirectDecisionApplied, type JobRecord } from '../runner/business/index.js'
import { readJobLogDelta } from '../logs/business/index.js'
import { SelfMcpServer } from '../mcp/business/index.js'
import { validateDecision } from './business/decision.js'
import {
  applyCheckedDecision,
  isOrchestratorJob,
  liveJobsOfTask,
  readTaskPhase,
  recentOf,
} from './business/decisionLoop.js'
import { resolveOrchestratorToken } from './business/orchestratorTokens.js'
import type { TaskRef } from './schemas/orchestrator.js'

/**
 * Job orchestrator đang chạy CỦA ĐÚNG `ref` — lọc theo loại job, không dùng
 * `resolveTaskJobId` (chọn job sống mới nhất bất kể loại): job step chạy song
 * song và mới hơn không được che job điều phối (G4b).
 */
function currentOrchestratorJobId(ref: TaskRef): string | null {
  const live = liveJobsOfTask(ref.root, ref.taskId).filter(isOrchestratorJob)
  return (live.find((j) => j.status === 'running') ?? live[0])?.id ?? null
}

/**
 * Job step mà agent điều phối muốn đọc output: đang sống (ưu tiên `running` —
 * job `queued` mới hơn chưa có log), nếu không thì vừa xong gần nhất (G4a). Job
 * điều phối của chính nó bị loại. Nhánh fallback vẫn so `devTeamRoot` — không
 * lộ output chéo task trùng tên giữa 2 project (G3).
 */
function stepJobOfTask(ref: TaskRef): JobRecord | null {
  const live = liveJobsOfTask(ref.root, ref.taskId).filter((j) => !isOrchestratorJob(j))
  const pick = live.find((j) => j.status === 'running') ?? live[0]
  if (pick) return pick
  return (
    listJobs(200).find(
      (j) => j.metadata?.taskId === ref.taskId && j.metadata?.devTeamRoot === ref.root && !isOrchestratorJob(j),
    ) ?? null
  )
}

/**
 * API REST cho orchestrator gọi ngược vào chính server này giữa lượt (§3.1/§4.2
 * design.md, bản v2 — KHÔNG phải MCP). Xác thực bằng token 1-lần/1-job
 * (`orchestratorTokens.ts`), không phải JWT dashboard. Agent gọi 3 route này
 * bằng shell command (`curl`) — hướng dẫn nằm trong `buildDecisionPrompt`.
 */
export class OrchestratorController extends AbstractController {
  /**
   * Token đọc từ `SelfMcpServer.TOKEN_HEADER` — hằng hợp đồng chung với tool
   * `orchestrator_decide` của tiến trình `mcp/`. Giá trị token do
   * `SelfMcpServer.childEnv` bơm vào env `DASHBOARD_ORCHESTRATOR_TOKEN` của
   * tiến trình con; agent tự đọc lại khi chạy `curl`.
   */
  private resolveRef(): TaskRef | null {
    const token = this.c.req.header(SelfMcpServer.TOKEN_HEADER)
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
    const job = stepJobOfTask(ref)
    if (!job) return this.json(200, { text: '', eof: true })
    const delta = await readJobLogDelta(job.id, { offset: Number.isFinite(offset) ? offset : 0, waitMs: 0 })
    return this.json(200, delta)
  }

  /** `POST /api/orchestrator/decide` — start/resume/halt/summary, có hiệu lực ngay. */
  async postDecide(): Promise<Response> {
    const ref = this.resolveRef()
    if (!ref) return this.json(401, { error: 'invalid or expired orchestrator token' })

    const body = await this.parseBody()
    if (!body.ok) return this.json(400, { error: 'invalid JSON' })

    const decision = await applyCheckedDecision(
      ref,
      (stepIds) => validateDecision(body.value, stepIds),
      // Đánh dấu TRƯỚC KHI thi hành: `applyDecision` (action `start`) tạo ngay
      // một job step mới. `currentOrchestratorJobId` đã lọc theo loại job nên
      // không gắn nhầm cờ lên job step đó, nhưng đánh dấu trước vẫn là thứ tự
      // đúng (chống double-dispatch với sentinel cuối output).
      () => {
        const currentJobId = currentOrchestratorJobId(ref)
        if (currentJobId) markDirectDecisionApplied(currentJobId)
      },
    )
    if ('error' in decision) return this.json(400, { error: decision.error })
    return this.json(200, { applied: decision.action })
  }
}
