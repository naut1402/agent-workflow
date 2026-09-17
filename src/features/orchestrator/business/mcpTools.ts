/**
 * Tool MCP cấp cho orchestrator một kênh ra lệnh **trực tiếp**, giữa lượt —
 * thay vì chỉ đọc được ý định của nó sau khi job của chính nó kết thúc, qua
 * dòng `ORCHESTRATOR_DECISION` cuối output (xem `decision.ts`).
 *
 * Mount qua `OrchestratorController.handleMcp` (Streamable HTTP), KHÔNG phải
 * process MCP stdio riêng: tool handler ở đây chạy TRONG process server chính
 * nên gọi thẳng được `dispatchStep`/`haltTask`/... — process stdio riêng sẽ có
 * Map in-memory (`jobAbortControllers`, `queue`...) RIÊNG, không đồng bộ với
 * process thật (xem design §3.1).
 */
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { APP_VERSION } from '../../../backend/configs/appVersion.js'
import { loadJob, markMcpDecisionApplied } from '../../runner/business/index.js'
import { readJobLogDelta, resolveTaskJobId } from '../../logs/business/index.js'
import { loadPipelineConfig } from '../../pipeline-editor/business/pipeline/index.js'
import { validateDecision } from './decision.js'
import {
  applyDecision,
  hasPendingStep,
  isOrchestratorJob,
  liveJobsOfTask,
  readTaskPhase,
  recentOf,
  type TaskRef,
} from './decisionLoop.js'

// Return `any` để không ràng buộc vào union content-type literal của SDK.
function ok(payload: unknown): any {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] }
}

function fail(message: unknown): any {
  return { isError: true, content: [{ type: 'text', text: String(message) }] }
}

/**
 * Job orchestrator đang chạy CỦA ĐÚNG `ref` — tự soi lại `devTeamRoot` (G3 +
 * phát hiện #5: `resolveTaskJobId` không lọc theo root, chỉ so `taskId`).
 */
function currentOrchestratorJobId(ref: TaskRef): string | null {
  const jobId = resolveTaskJobId(ref.taskId)
  if (!jobId) return null
  const job = loadJob(jobId)
  if (!job || job.metadata?.devTeamRoot !== ref.root || job.metadata?.orchestratorJob !== true) return null
  return jobId
}

/** 3 tool, mỗi tool đóng cứng `ref` qua closure — KHÔNG nhận `taskId`/`root` làm tham số từ agent (G3). */
export function createOrchestratorMcpServer(ref: TaskRef): McpServer {
  const server = new McpServer({ name: 'dev-team-orchestrator', version: APP_VERSION })

  server.tool(
    'orchestrator_status',
    'Trạng thái thật của task đang điều phối — step đang chạy (nếu có), gate đang chờ, event gần đây.',
    {},
    async () => {
      const at = await readTaskPhase(ref.root, ref.taskId)
      const live = liveJobsOfTask(ref.root, ref.taskId).find((j) => !isOrchestratorJob(j))
      return ok({
        currentPhase: at.phase,
        gatePending: at.gatePending ?? null,
        activeStep: live
          ? { stepId: live.metadata?.pipelineStepId ?? null, status: live.status, jobId: live.id }
          : null,
        recent: recentOf(ref.root, ref.taskId),
      })
    },
  )

  server.tool(
    'orchestrator_read_output',
    'Đọc output hiện tại của step đang/đã chạy trong CÙNG task — không cần chờ job đó kết thúc.',
    { offset: z.number().int().min(0).optional().describe('Byte offset lần đọc trước, 0 nếu đọc từ đầu') },
    async ({ offset }) => {
      const jobId = resolveTaskJobId(ref.taskId)
      const job = jobId ? loadJob(jobId) : null
      // Job thuộc root khác (taskId trùng tên giữa 2 project) — không lộ output chéo task (G3).
      if (!job || job.metadata?.devTeamRoot !== ref.root) return ok({ text: '', eof: true })
      const delta = await readJobLogDelta(jobId as string, { offset, waitMs: 0 })
      return ok(delta)
    },
  )

  server.tool(
    'orchestrator_decide',
    'Quyết định hành động — start/resume/halt/summary. Cùng ngữ nghĩa với dòng ORCHESTRATOR_DECISION '
      + 'cuối output; gọi tool này thì KHÔNG cần in lại dòng đó nữa (double-dispatch).',
    {
      action: z.enum(['start', 'resume', 'halt', 'summary']),
      stepId: z.string().optional(),
      reason: z.string().optional(),
      message: z.string().optional(),
      summary: z.string().optional(),
      context: z.string().optional(),
    },
    async (args) => {
      const pipeline = await loadPipelineConfig(ref.root, ref.taskId)
      const stepIds = (pipeline.steps || []).map((s: any) => s?.id).filter(Boolean)
      const decision = validateDecision(args, stepIds)
      if ('error' in decision) return fail(decision.error)

      // Đánh dấu TRƯỚC KHI thi hành: `applyDecision` (action `start`) tạo ngay
      // một job step mới, và `resolveTaskJobId` ưu tiên job MỚI NHẤT — đánh dấu
      // sau sẽ vô tình gắn cờ lên job step đó thay vì job orchestrator đang gọi
      // tool này (G4 — chống double-dispatch với sentinel cuối output).
      const currentJobId = currentOrchestratorJobId(ref)
      if (currentJobId) markMcpDecisionApplied(currentJobId)

      const at = await readTaskPhase(ref.root, ref.taskId)
      await applyDecision(ref, decision, { gatePending: at.gatePending, completed: !hasPendingStep(at) })
      return ok({ applied: decision.action })
    },
  )

  return server
}
