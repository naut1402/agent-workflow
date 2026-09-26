import { z } from 'zod'

/** Nguồn duy nhất — dùng chung với canvas và khung chat, xem `shared/lib/orchestrator.ts`. */
export { DECISION_SENTINEL, ORCHESTRATOR_STEP_ID } from '../../../shared/lib/orchestrator.js'

/** Ngân sách brief — bằng `CHAT_STDOUT_LIMIT` của jobQueue. */
export const MAX_BRIEF_BYTES = 64 * 1024

// Dòng quyết định là một dòng JSON nằm trong stdout, mà stdout bị cắt ở
// `CHAT_STDOUT_LIMIT` — phần agent tự soạn vượt trần này làm JSON đứt.
export const MAX_AGENT_CONTEXT_BYTES = 8 * 1024

/** Key `orchestrator` trong `pipeline.yaml`. Thiếu key ⇒ `enabled: false` ⇒ pipeline chạy như cũ. */
export const OrchestratorConfig = z
  .object({
    enabled: z.boolean().optional(),
    agent: z.string().optional(),
  })
  .passthrough()

export type OrchestratorConfig = z.infer<typeof OrchestratorConfig>

/**
 * Quyết định của agent điều phối, đọc từ dòng `ORCHESTRATOR_DECISION: {json}`.
 *
 * `stepId` bắt buộc với `start`/`resume`/`respawn` (kiểm thêm "có trong
 * pipeline" ở `parseDecision`); `halt` và `summary` thì không cần. `message`
 * là nội dung gửi kèm khi resume — chính là kênh giao tiếp reviewer →
 * implementer. `respawn` chạy một phiên mới cho một step đã từng chạy xong,
 * bất kể `current_phase` — không yêu cầu `message` (khác `resume`).
 */
export const OrchestratorDecision = z
  .object({
    action: z.enum(['start', 'resume', 'halt', 'summary', 'respawn']),
    stepId: z.string().min(1).optional(),
    reason: z.string().optional(),
    message: z.string().optional(),
    /** Tóm tắt kết quả bước vừa xong — hiện ở chat của node, đi vào brief bước kế. */
    summary: z.string().max(MAX_AGENT_CONTEXT_BYTES).optional(),
    /** Bối cảnh agent soạn riêng cho step sắp chạy. Dùng cùng `start`/`respawn`. */
    context: z.string().max(MAX_AGENT_CONTEXT_BYTES).optional(),
  })
  .superRefine((d, ctx) => {
    if ((d.action === 'start' || d.action === 'resume' || d.action === 'respawn') && !d.stepId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'stepId required', path: ['stepId'] })
    }
    // `resume` không có nội dung nghĩa là step nhận `userPrompt` rỗng — chặn ở
    // đây để nó rơi vào nhánh halt tường minh thay vì chạy một lượt vô nghĩa.
    if (d.action === 'resume' && !d.message?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'message required for resume', path: ['message'] })
    }
  })

export type OrchestratorDecision = z.infer<typeof OrchestratorDecision>
