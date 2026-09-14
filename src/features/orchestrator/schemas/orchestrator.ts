import { z } from 'zod'

/** Nguồn duy nhất — dùng chung với canvas, xem `shared/lib/orchestrator.ts`. */
export { ORCHESTRATOR_STEP_ID } from '../../../shared/lib/orchestrator.js'

/** Dòng cuối output agent phải bắt đầu bằng chuỗi này thì mới được coi là quyết định. */
export const DECISION_SENTINEL = 'ORCHESTRATOR_DECISION:'

/** Ngân sách brief — bằng `CHAT_STDOUT_LIMIT` của jobQueue. */
export const MAX_BRIEF_BYTES = 64 * 1024

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
 * `stepId` bắt buộc với `start`/`resume` (kiểm thêm "có trong pipeline" ở
 * `parseDecision`); `halt` thì không cần. `message` là nội dung gửi kèm khi
 * resume — chính là kênh giao tiếp reviewer → implementer.
 */
export const OrchestratorDecision = z
  .object({
    action: z.enum(['start', 'resume', 'halt']),
    stepId: z.string().min(1).optional(),
    reason: z.string().optional(),
    message: z.string().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.action !== 'halt' && !d.stepId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'stepId required', path: ['stepId'] })
    }
    // `resume` không có nội dung nghĩa là step nhận `userPrompt` rỗng — chặn ở
    // đây để nó rơi vào nhánh halt tường minh thay vì chạy một lượt vô nghĩa.
    if (d.action === 'resume' && !d.message?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'message required for resume', path: ['message'] })
    }
  })

export type OrchestratorDecision = z.infer<typeof OrchestratorDecision>
