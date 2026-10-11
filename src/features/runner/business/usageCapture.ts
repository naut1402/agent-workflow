import { appendUsageLog } from '../../../backend/log/store.js'
import { isLogTypeEnabled } from '../../../backend/log/loggingPrefsIo.js'
import type { UsageSnapshot } from '../../../shared/log/schema.js'
import type { TokenUsage, UsageSource } from './providers/RunnerProvider.js'
import type { JobRecord } from './types.js'
import { loadJob, mergeJobUsage, stepIdOf } from './jobRecords.js'

/**
 * Ghi usage của một job: gộp vào `JobRecord.usage` + append usage log. Một chỗ
 * dựng `UsageSnapshot` cho mọi nguồn — `provider` = providerId, `source` ∈
 * `aggregate` (provider tự đọc, vd transcript Claude) | `stdout`
 * (`ExecuteResult.tokenUsage`). Đây là hợp đồng dữ liệu statistics đọc lại.
 */

function metaString(job: JobRecord, key: string): string | null {
  const v = job.metadata?.[key]
  return typeof v === 'string' && v ? v : null
}

function durationMsOf(job: JobRecord, finishedAt: string): number | null {
  if (!job.startedAt) return null
  const start = Date.parse(job.startedAt)
  const end = Date.parse(finishedAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  return end - start
}

function numTok(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0
}

/** Token đã chuẩn hoá — đầu vào của `recordJobUsage`. */
export interface JobUsageTokens {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
}

/**
 * Dựng snapshot, gộp vào job record và append usage log với `source`.
 * Caller đã kiểm `isLogTypeEnabled('usage')`.
 */
export async function recordJobUsage(
  job: JobRecord,
  input: {
    providerId: string
    tokens: JobUsageTokens
    model: string | null
    sessionId: string | null
    source: UsageSource
  },
): Promise<void> {
  const finishedAt = job.finishedAt || new Date().toISOString()
  const snapshot: UsageSnapshot = {
    inputTokens: input.tokens.inputTokens,
    outputTokens: input.tokens.outputTokens,
    cacheReadTokens: input.tokens.cacheReadTokens,
    cacheWriteTokens: input.tokens.cacheWriteTokens,
    totalTokens: input.tokens.totalTokens,
    estimatedCostUsd: null,
    model: input.model,
    provider: input.providerId,
    taskId: metaString(job, 'taskId'),
    projectId: metaString(job, 'projectId'),
    stepId: stepIdOf(job) ?? null,
    phase: metaString(job, 'phase'),
    pipelineId: metaString(job, 'pipelineId'),
    jobId: job.id,
    sessionId: input.sessionId,
    startedAt: job.startedAt,
    finishedAt,
    durationMs: durationMsOf(job, finishedAt),
  }
  const cur = loadJob(job.id)
  if (cur) mergeJobUsage(cur.id, snapshot)
  await appendUsageLog({ ...snapshot, source: input.source })
}

/**
 * Persist token usage already present on `ExecuteResult` (e.g. Cursor JSON stdout).
 * Prefs `logging.types.usage === false` skips JobRecord + JSONL.
 */
export async function captureTokenUsageFromExecute(
  job: JobRecord,
  providerId: string,
  tokenUsage: TokenUsage,
  sessionId: string | null,
): Promise<void> {
  if (!isLogTypeEnabled('usage')) return
  const inputTokens = numTok(tokenUsage.inputTokens)
  const outputTokens = numTok(tokenUsage.outputTokens)
  const cacheReadTokens = numTok(tokenUsage.cacheReadTokens)
  const cacheWriteTokens = numTok(tokenUsage.cacheWriteTokens)
  const summed = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens
  const totalTokens = numTok(tokenUsage.totalTokens) || summed
  if (totalTokens <= 0 && summed <= 0) return

  const model =
    typeof tokenUsage.model === 'string' && tokenUsage.model.trim()
      ? tokenUsage.model.trim()
      : typeof job.metadata?.model === 'string'
        ? job.metadata.model
        : null

  await recordJobUsage(job, {
    providerId,
    tokens: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens: totalTokens || summed },
    model,
    sessionId,
    source: 'stdout',
  })
}
