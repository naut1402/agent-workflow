import { z } from 'zod'

/** Nguồn duy nhất — dùng chung với canvas và khung chat, xem `shared/lib/orchestrator.ts`. */
export { DECISION_SENTINEL, ORCHESTRATOR_STEP_ID, STEP_SUMMARY_PREFIX } from '../../../shared/lib/orchestrator.js'

/** Ngân sách brief — bằng `CHAT_STDOUT_LIMIT` của jobQueue. */
export const MAX_BRIEF_BYTES = 64 * 1024

// xem docs/architecture/code/orchestrator.md §10
export const MAX_AGENT_CONTEXT_BYTES = 8 * 1024

/**
 * Ngân sách byte cho kết quả một bước đi vào prompt điều phối.
 * xem docs/architecture/code/orchestrator.md §10
 */
export const MAX_STEP_RESULT_BYTES = 2 * 1024

/** Key `orchestrator` trong `pipeline.yaml`. Thiếu key ⇒ `enabled: false`. */
export const OrchestratorConfig = z
  .object({
    enabled: z.boolean().optional(),
    agent: z.string().optional(),
    system_prompt: z.string().optional(),
    knowledge_inputs: z.array(z.string()).optional(),
  })
  .passthrough()

export type OrchestratorConfig = z.infer<typeof OrchestratorConfig>

/**
 * Quyết định của agent điều phối, đọc từ dòng `ORCHESTRATOR_DECISION: {json}`.
 * `stepId` bắt buộc với `start`/`resume`/`respawn`; `message` bắt buộc với `resume`.
 * Raw shape không chứa ràng buộc chéo field — xem docs/architecture/code/orchestrator.md §10
 */
export const OrchestratorDecisionShape = {
  action: z
    .enum(['start', 'resume', 'halt', 'summary', 'respawn'])
    .describe(
      '`start` chạy một step mới (cần `stepId`) · `resume` gửi tiếp phản hồi cho step đã chạy, '
      + 'giữ nguyên `current_phase` (cần `stepId` + `message`) · `summary` ghi nhận kết quả, '
      + 'không chạy step nào · `halt` dừng điều phối, trả quyền chạy tay lại cho người dùng · '
      + '`respawn` chạy một PHIÊN MỚI cho step đã từng chạy xong (cần `stepId`).',
    ),
  stepId: z
    .string()
    .min(1)
    .optional()
    .describe('Id step trong pipeline. Bắt buộc với `start`/`resume`/`respawn`.'),
  reason: z.string().optional().describe('Lý do ngắn gọn của quyết định, để người đọc log hiểu.'),
  message: z
    .string()
    .optional()
    .describe('Nội dung gửi kèm khi `resume` — kênh giao tiếp reviewer → implementer. Bắt buộc với `resume`.'),
  /** Tóm tắt kết quả bước vừa xong — hiện ở chat của node, đi vào brief bước kế. */
  summary: z
    .string()
    .max(MAX_AGENT_CONTEXT_BYTES)
    .optional()
    .describe(`Tóm tắt bước vừa xong, tối đa ${MAX_AGENT_CONTEXT_BYTES} byte.`),
  /** Bối cảnh agent soạn riêng cho step sắp chạy. Dùng cùng `start`/`respawn`. */
  context: z
    .string()
    .max(MAX_AGENT_CONTEXT_BYTES)
    .optional()
    .describe(`Bối cảnh soạn riêng cho step sắp chạy, tối đa ${MAX_AGENT_CONTEXT_BYTES} byte.`),
}

export const OrchestratorDecision = z
  .object(OrchestratorDecisionShape)
  .superRefine((d, ctx) => {
    if ((d.action === 'start' || d.action === 'resume' || d.action === 'respawn') && !d.stepId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'stepId required', path: ['stepId'] })
    }
    if (d.action === 'resume' && !d.message?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'message required for resume', path: ['message'] })
    }
  })

export type OrchestratorDecision = z.infer<typeof OrchestratorDecision>
