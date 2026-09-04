import { z } from 'zod'

/**
 * Automation rule = triggers[] → actions[] (#233).
 * Zod là nguồn chân lý — persist YAML + request body đều parse qua đây.
 *
 * - Nhiều trigger: rule chạy khi **bất kỳ** trigger nào khớp (OR).
 * - Trigger thời gian gom về một loại `timer` với mốc `startAt` chung —
 *   khác nhau ở `repeat`: một lần / định kỳ / cron.
 * - Nhiều action: chạy **tuần tự** theo thứ tự mảng; bước sau tham chiếu
 *   output bước trước qua biến `{{steps.N.…}}` / `{{trigger.…}}`.
 */

/**
 * Id charset cho rule file `automations/<id>.yaml` — chặn path-traversal:
 * slug thường, không separator/.., tối đa 64 ký tự.
 */
export const AUTOMATION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

export const AutomationIdSchema = z.string().regex(AUTOMATION_ID_PATTERN, 'invalid automation id')

export const AUTOMATION_TRIGGER_KINDS = ['timer', 'event'] as const
export type AutomationTriggerKind = (typeof AUTOMATION_TRIGGER_KINDS)[number]

/** Cron 5 field (minute hour dom month dow) — ngữ nghĩa kiểm tra ở matcher. */
const CRON_SHAPE = /^\s*\S+\s+\S+\s+\S+\s+\S+\s+\S+\s*$/

const IsoDateTime = z
  .string()
  .min(1)
  .refine((v) => !Number.isNaN(Date.parse(v)), 'invalid ISO datetime')

/** Id ổn định của trigger trong rule (neo state fired/lastRun theo trigger). */
const TriggerId = z.string().regex(/^t\d{1,3}$/, 'invalid trigger id')

/**
 * Trigger thời gian — mốc `startAt` dùng chung:
 * - `once`: chạy đúng một lần tại `startAt`.
 * - `interval`: chạy tại `startAt` và lặp lại mỗi `everyMs`.
 * - `cron`: lịch cron tính từ `startAt` (mốc tham chiếu lần đầu).
 */
const TimerOnce = z.object({ mode: z.literal('once') })
const TimerInterval = z.object({
  mode: z.literal('interval'),
  everyMs: z.number().int().min(60_000).max(365 * 24 * 3_600_000),
})
const TimerCron = z.object({
  mode: z.literal('cron'),
  expr: z.string().regex(CRON_SHAPE, 'cron must have 5 fields'),
})
const TimerRepeat = z.discriminatedUnion('mode', [TimerOnce, TimerInterval, TimerCron])
export type TimerRepeat = z.infer<typeof TimerRepeat>

const TimerTrigger = z.object({
  /** Optional khi gửi từ FE — server mint `t1`, `t2`… khi lưu. */
  id: TriggerId.optional(),
  kind: z.literal('timer'),
  startAt: IsoDateTime,
  repeat: TimerRepeat,
})

const EventTrigger = z.object({
  id: TriggerId.optional(),
  kind: z.literal('event'),
  /** Domain event trong dự án (payload.projectId phải khớp project của rule). */
  eventType: z.string().min(1).max(100),
})

export const AutomationTrigger = z.discriminatedUnion('kind', [TimerTrigger, EventTrigger])
export type AutomationTrigger = z.infer<typeof AutomationTrigger>

export const MAX_TRIGGERS = 5
export const MAX_ACTIONS = 10

/**
 * Action `runTask`:
 * - `create`: tạo task mới từ prompt (đường createTask + submitJob createTaskRun)
 * - `existing`: chạy task có sẵn theo pipeline hiện tại (đường run-step)
 * Các trường text hỗ trợ biến `{{trigger.…}}` / `{{steps.N.…}}` (thay khi chạy).
 */
/**
 * Object thuần (không `.superRefine`) — bắt buộc để dùng làm nhánh trong
 * `z.discriminatedUnion` (yêu cầu `ZodObject`, không nhận `ZodEffects`).
 * Validate `mode`↔`prompt`/`taskId` áp ở `AutomationAction.superRefine` bên dưới.
 */
const RunTaskAction = z.object({
  kind: z.literal('runTask'),
  /** Nhãn bước trên timeline (hiển thị). */
  name: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
  mode: z.enum(['create', 'existing']),
  /** mode=create: nội dung request.md của task mới. */
  prompt: z.string().min(1).max(200_000).optional(),
  /** mode=create: pipeline profile đặt tên trong `pipeline-profiles/`. */
  profileName: z.string().min(1).max(100).nullish(),
  runnerId: z.string().min(1).nullish(),
  /** mode=existing: task cần chạy. */
  taskId: z.string().regex(/^[A-Za-z0-9][\w-]{0,63}$/, 'invalid task id').optional(),
})
export type RunTaskAction = z.infer<typeof RunTaskAction>

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

/**
 * Action `httpRequest`: gọi HTTP tuỳ method/headers/body qua `fetchUrlSafe`
 * (duy nhất nơi enforce SSRF — https-only + chặn private host).
 */
const HttpRequestAction = z.object({
  kind: z.literal('httpRequest'),
  name: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
  method: z.enum(HTTP_METHODS).default('GET'),
  url: z.string().min(1).max(2000),
  /** header name→value; https-only/SSRF check ở runtime qua fetchUrlSafe, không ở schema. */
  headers: z.record(z.string().max(200), z.string().max(2000)).optional(),
  body: z.string().max(100_000).optional(),
})
export type HttpRequestAction = z.infer<typeof HttpRequestAction>

/**
 * Action `runCommand`: chạy job qua runner đã cấu hình (khuyến nghị provider
 * `console-command`), `params` là argv tự do — split giống console-command hiện có.
 */
const RunCommandAction = z.object({
  kind: z.literal('runCommand'),
  name: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
  runnerId: z.string().min(1),
  params: z.string().max(20_000).optional(),
})
export type RunCommandAction = z.infer<typeof RunCommandAction>

export const AutomationAction = z
  .discriminatedUnion('kind', [RunTaskAction, HttpRequestAction, RunCommandAction])
  .superRefine((a, ctx) => {
    if (a.kind !== 'runTask') return
    if (a.mode === 'create' && !a.prompt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['prompt'], message: 'prompt is required for mode=create' })
    }
    if (a.mode === 'existing' && !a.taskId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['taskId'], message: 'taskId is required for mode=existing' })
    }
  })
export type AutomationAction = z.infer<typeof AutomationAction>

export const AutomationRuleRecord = z.object({
  version: z.literal(1),
  id: AutomationIdSchema,
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  enabled: z.boolean(),
  triggers: z.array(AutomationTrigger).min(1).max(MAX_TRIGGERS),
  actions: z.array(AutomationAction).min(1).max(MAX_ACTIONS),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
})
export type AutomationRuleRecord = z.infer<typeof AutomationRuleRecord>

/** Body tạo rule (`POST /api/automations`) — id/createdAt/trigger id do server sinh. */
export const CreateAutomationRequest = z.object({
  id: AutomationIdSchema.optional(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  enabled: z.boolean().default(true),
  triggers: z.array(AutomationTrigger).min(1).max(MAX_TRIGGERS),
  actions: z.array(AutomationAction).min(1).max(MAX_ACTIONS),
})
export type CreateAutomationRequest = z.infer<typeof CreateAutomationRequest>

/** Body cập nhật rule (`PUT /api/automations/:id`) — thay thế toàn bộ nội dung. */
export const UpdateAutomationRequest = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  enabled: z.boolean(),
  triggers: z.array(AutomationTrigger).min(1).max(MAX_TRIGGERS),
  actions: z.array(AutomationAction).min(1).max(MAX_ACTIONS),
})
export type UpdateAutomationRequest = z.infer<typeof UpdateAutomationRequest>

/** Chỉ bật/tắt (`POST /api/automations/:id/toggle`). */
export const ToggleAutomationRequest = z.object({
  enabled: z.boolean(),
})

// ── Legacy → shape mới (rule tạo trước khi gom timer / mảng hoá) ────────────

/**
 * Chuẩn hoá document cũ sang shape hiện hành trước khi safeParse:
 * - `trigger` đơn (time|interval|cron|event) → `triggers: [timer|event]`
 *   (interval/cron lấy mốc `startAt` = createdAt của record cũ).
 * - `action` đơn → `actions: [action]`.
 * Idempotent với document mới (đã có triggers/actions). Không throw.
 */
export function normaliseAutomationDoc(raw: unknown): Record<string, any> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const doc: Record<string, any> = { ...(raw as Record<string, any>) }

  // YAML 1.1 có thể parse timestamp ISO thành Date — chuẩn về chuỗi ISO.
  const asIso = (v: unknown): unknown => (v instanceof Date ? v.toISOString() : v)
  if (doc.createdAt) doc.createdAt = asIso(doc.createdAt)
  if (doc.updatedAt) doc.updatedAt = asIso(doc.updatedAt)

  if (!Array.isArray(doc.triggers) && doc.trigger && typeof doc.trigger === 'object') {
    const old = doc.trigger
    const anchor: unknown =
      typeof doc.createdAt === 'string' && !Number.isNaN(Date.parse(doc.createdAt))
        ? doc.createdAt
        : new Date().toISOString()
    let converted: Record<string, unknown>
    if (old.kind === 'time') {
      converted = { id: 't1', kind: 'timer', startAt: asIso(old.at), repeat: { mode: 'once' } }
    } else if (old.kind === 'interval') {
      converted = { id: 't1', kind: 'timer', startAt: anchor, repeat: { mode: 'interval', everyMs: old.everyMs } }
    } else if (old.kind === 'cron') {
      converted = { id: 't1', kind: 'timer', startAt: anchor, repeat: { mode: 'cron', expr: old.cron } }
    } else if (old.kind === 'event') {
      converted = { id: 't1', kind: 'event', eventType: old.eventType }
    } else {
      converted = old
    }
    doc.triggers = [converted]
  }
  if (Array.isArray(doc.triggers)) {
    doc.triggers = doc.triggers.map((tr: any) =>
      tr && typeof tr === 'object' && tr.startAt !== undefined ? { ...tr, startAt: asIso(tr.startAt) } : tr,
    )
  }
  if (!Array.isArray(doc.actions) && doc.action && typeof doc.action === 'object') {
    doc.actions = [doc.action]
  }
  if (Array.isArray(doc.actions)) {
    doc.actions = doc.actions.map((a: any) =>
      a && typeof a === 'object' && !a.kind ? { ...a, kind: 'runTask' } : a,
    )
  }
  delete doc.trigger
  delete doc.action
  return doc
}

// ── Runtime state / run history (FE + BE dùng chung — persist ở
// registryHome/automations, xem business/runLedger.ts) ─────────────────────

export type AutomationRunOutcome = 'running' | 'succeeded' | 'failed' | 'skipped'

/** Kết quả từng bước trong run — stdout/artifact cho bước sau tham chiếu. */
export interface AutomationStepResult {
  index: number
  name?: string
  taskId?: string
  jobId?: string
  status: string
  /** Cấu hình action đã resolve biến — hiển thị lại để xác nhận input đã chạy. */
  input?: Record<string, unknown>
  stdout?: string
  artifacts?: Record<string, string>
  error?: string
}

export interface AutomationRun {
  version: 1
  runId: string
  automationId: string
  projectId: string
  /** Cách rule được kích hoạt: manual (Run now) / schedule / event. */
  source: 'manual' | 'schedule' | 'event'
  /** Trigger khớp (id của trigger trong rule, hoặc 'manual'). */
  triggerId: string
  triggerKind: string
  startedAt: string
  finishedAt: string | null
  outcome: AutomationRunOutcome
  error?: string
  steps?: AutomationStepResult[]
}

export interface RuleRuntimeState {
  lastRunAt: string | null
  lastOutcome: AutomationRunOutcome | null
  /** One-shot `once`: trigger id đã chạy (không chạy lại). */
  triggerFired?: Record<string, boolean>
  /** Có run đang thực thi (crash giữa chừng → startup sweep xoá). */
  inFlight?: boolean
}
