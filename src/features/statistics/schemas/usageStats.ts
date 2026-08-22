import { z } from 'zod'

/**
 * Zod là nguồn chân lý cho query + response thống kê usage (issue #231).
 * Dùng chung BE (controller validate) và FE (type response) — KHÔNG import
 * `node:*` ở đây vì FE cũng consume module này.
 */

/** Dimension grouping. `tool-call` là P2 (parse transcript) — chưa có ở đây. */
export const USAGE_GROUP_BYS = [
  'project',
  'task',
  'step',
  'job',
  'model',
  'provider',
  'date',
  'source',
] as const
export type UsageGroupBy = (typeof USAGE_GROUP_BYS)[number]

/** Metric token hiển thị — FE chọn, BE trả đủ mọi metric cho mỗi group. */
export const USAGE_METRICS = [
  'totalTokens',
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
] as const
export type UsageMetric = (typeof USAGE_METRICS)[number]

/** Chuỗi filter ngắn, không ký tự điều khiển — không dựng path từ giá trị này. */
const filterString = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[\w\-.:@ +]+$/)

/** `from`/`to`: ISO date/datetime hoặc epoch-ms; parse số tại controller. */
export const UsageStatsQuerySchema = z.object({
  project: filterString.optional(),
  taskId: filterString.optional(),
  stepId: filterString.optional(),
  from: filterString.optional(),
  to: filterString.optional(),
  groupBy: z.enum(USAGE_GROUP_BYS).default('task'),
})
export type UsageStatsQuery = z.infer<typeof UsageStatsQuerySchema>

/** Một dòng tổng hợp theo group (key = giá trị dimension, '' khi thiếu attribution). */
export const UsageGroupSchema = z.object({
  key: z.string(),
  entries: z.number().int().nonnegative(),
  jobs: z.number().int().nonnegative(),
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  cacheReadTokens: z.number().nonnegative(),
  cacheWriteTokens: z.number().nonnegative(),
  totalTokens: z.number().nonnegative(),
  /** Tổng durationMs các entry có (ms) — 0 khi không entry nào có. */
  durationMs: z.number().nonnegative(),
  firstTs: z.number(),
  lastTs: z.number(),
  /** Mốc theo từng entry trong group — thước đo phức tạp task (min/max/avg). */
  minTotalTokens: z.number().nonnegative(),
  maxTotalTokens: z.number().nonnegative(),
  /** Trung bình totalTokens mỗi entry trong group. */
  avgTotalTokens: z.number().nonnegative(),
  /** Duration stats — null khi không entry nào có duration. */
  minDurationMs: z.number().nullable(),
  maxDurationMs: z.number().nullable(),
  avgDurationMs: z.number().nullable(),
})
export type UsageGroup = z.infer<typeof UsageGroupSchema>

export const UsageTotalsSchema = z.object({
  entries: z.number().int().nonnegative(),
  jobs: z.number().int().nonnegative(),
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  cacheReadTokens: z.number().nonnegative(),
  cacheWriteTokens: z.number().nonnegative(),
  totalTokens: z.number().nonnegative(),
  durationMs: z.number().nonnegative(),
  firstTs: z.number().nullable(),
  lastTs: z.number().nullable(),
  /** Thống kê theo TỪNG ENTRY trên toàn phạm vi (đã filter) — cho card summary. */
  minTotalTokens: z.number().nonnegative(),
  maxTotalTokens: z.number().nonnegative(),
  avgTotalTokens: z.number().nonnegative(),
  minDurationMs: z.number().nullable(),
  maxDurationMs: z.number().nullable(),
  avgDurationMs: z.number().nullable(),
})
export type UsageTotals = z.infer<typeof UsageTotalsSchema>

export const UsageStatsResultSchema = z.object({
  groupBy: z.enum(USAGE_GROUP_BYS),
  groups: z.array(UsageGroupSchema),
  /** true khi vượt MAX_GROUPS — group yếu nhất bị bỏ để biểu đồ không vỡ. */
  truncated: z.boolean(),
  totals: UsageTotalsSchema,
})
export type UsageStatsResult = z.infer<typeof UsageStatsResultSchema>
