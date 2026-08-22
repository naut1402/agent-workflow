import { z } from 'zod'

/**
 * Automation rule = trigger → action (issue #233).
 * Zod là nguồn chân lý — persist YAML + request body đều parse qua đây.
 */

/**
 * Id charset cho rule file `automations/<id>.yaml` — chặn path-traversal:
 * slug thường, không separator/.., tối đa 64 ký tự.
 */
export const AUTOMATION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

export const AutomationIdSchema = z.string().regex(AUTOMATION_ID_PATTERN, 'invalid automation id')

export const AUTOMATION_TRIGGER_KINDS = ['time', 'interval', 'cron', 'event'] as const
export type AutomationTriggerKind = (typeof AUTOMATION_TRIGGER_KINDS)[number]

/** Cron 5 field (minute hour dom month dow) — ngữ nghĩa kiểm tra ở matcher. */
const CRON_SHAPE = /^\s*\S+\s+\S+\s+\S+\s+\S+\s+\S+\s*$/

const IsoDateTime = z
  .string()
  .min(1)
  .refine((v) => !Number.isNaN(Date.parse(v)), 'invalid ISO datetime')

const TimeTrigger = z.object({
  /** Chạy đúng một lần tại thời điểm `at` (ISO 8601). */
  kind: z.literal('time'),
  at: IsoDateTime,
})

const IntervalTrigger = z.object({
  /** Chạy lặp lại mỗi `everyMs` (mili-giây), ≥ 1 phút. */
  kind: z.literal('interval'),
  everyMs: z.number().int().min(60_000).max(365 * 24 * 3_600_000),
})

const CronTrigger = z.object({
  /** Biểu thức cron 5 field theo local timezone. */
  kind: z.literal('cron'),
  cron: z.string().regex(CRON_SHAPE, 'cron must have 5 fields'),
})

const EventTrigger = z.object({
  /** Domain event trong dự án (payload.projectId phải khớp project của rule). */
  kind: z.literal('event'),
  eventType: z.string().min(1).max(100),
})

export const AutomationTrigger = z.discriminatedUnion('kind', [
  TimeTrigger,
  IntervalTrigger,
  CronTrigger,
  EventTrigger,
])
export type AutomationTrigger = z.infer<typeof AutomationTrigger>

/**
 * P0 chỉ có action `runTask`:
 * - `create`: tạo task mới từ prompt (đường createTask + submitJob createTaskRun)
 * - `existing`: chạy task có sẵn theo pipeline hiện tại (đường run-step)
 */
const RunTaskAction = z
  .object({
    kind: z.literal('runTask'),
    mode: z.enum(['create', 'existing']),
    /** mode=create: nội dung request.md của task mới. */
    prompt: z.string().min(1).max(200_000).optional(),
    /** mode=create: pipeline profile đặt tên trong `pipeline-profiles/`. */
    profileName: z.string().min(1).max(100).nullish(),
    runnerId: z.string().min(1).nullish(),
    /** mode=existing: task cần chạy. */
    taskId: z.string().regex(/^[A-Za-z0-9][\w-]{0,63}$/, 'invalid task id').optional(),
  })
  .superRefine((a, ctx) => {
    if (a.mode === 'create' && !a.prompt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['prompt'], message: 'prompt is required for mode=create' })
    }
    if (a.mode === 'existing' && !a.taskId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['taskId'], message: 'taskId is required for mode=existing' })
    }
  })
export type RunTaskAction = z.infer<typeof RunTaskAction>

export const AutomationRuleRecord = z.object({
  version: z.literal(1),
  id: AutomationIdSchema,
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  enabled: z.boolean(),
  trigger: AutomationTrigger,
  action: RunTaskAction,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
})
export type AutomationRuleRecord = z.infer<typeof AutomationRuleRecord>

/** Body tạo rule (`POST /api/automations`) — id/createdAt do server sinh. */
export const CreateAutomationRequest = z.object({
  id: AutomationIdSchema.optional(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  enabled: z.boolean().default(true),
  trigger: AutomationTrigger,
  action: RunTaskAction,
})
export type CreateAutomationRequest = z.infer<typeof CreateAutomationRequest>

/** Body cập nhật rule (`PUT /api/automations/:id`) — thay thế toàn bộ nội dung. */
export const UpdateAutomationRequest = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  enabled: z.boolean(),
  trigger: AutomationTrigger,
  action: RunTaskAction,
})
export type UpdateAutomationRequest = z.infer<typeof UpdateAutomationRequest>

/** Chỉ bật/tắt (`POST /api/automations/:id/toggle`). */
export const ToggleAutomationRequest = z.object({
  enabled: z.boolean(),
})

// ── Runtime state / run history (FE + BE dùng chung — persist ở
// registryHome/automations, xem business/runLedger.ts) ─────────────────────

export type AutomationRunOutcome = 'running' | 'succeeded' | 'failed' | 'skipped'

export interface AutomationRun {
  version: 1
  runId: string
  automationId: string
  projectId: string
  /** Cách rule được kích hoạt: manual (Run now) / schedule / event. */
  source: 'manual' | 'schedule' | 'event'
  triggerKind: string
  startedAt: string
  finishedAt: string | null
  outcome: AutomationRunOutcome
  error?: string
  taskId?: string
  jobId?: string
}

export interface RuleRuntimeState {
  lastRunAt: string | null
  lastOutcome: AutomationRunOutcome | null
  /** One-shot `time`: đã chạy xong (đủ điều kiện không chạy lại). */
  fired?: boolean
  /** Có run đang thực thi (crash giữa chừng → startup sweep xoá). */
  inFlight?: boolean
}
