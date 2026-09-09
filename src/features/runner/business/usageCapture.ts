import { appendUsageLog } from '../../../core/log/store.js'
import { isLogTypeEnabled } from '../../../core/log/loggingPrefsIo.js'
import type { UsageSnapshot } from '../../../core/log/schema.js'
import {
  hasAnyTokens,
  listNewSubagentFiles,
  readNewUsage,
  readSubagentUsage,
  resolveSubagentFile,
  sessionTranscriptPath,
  subagentsDir,
  sumTokenUsage,
  totalTokensOf,
  type ClaudeTokenUsage,
} from './claudeUsageTranscript.js'
import { getUsageCursor, setUsageCursor } from './sessionLedger.js'
import type { ExecuteResult, JobRecord } from './types.js'

type UsagePart = {
  source: 'main' | 'subagent'
  usage: ClaudeTokenUsage
  model: string | null
}

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

/**
 * Persist token usage already present on `ExecuteResult` (e.g. Cursor JSON stdout).
 * Prefs `logging.types.usage === false` skips JobRecord + JSONL.
 */
export async function captureTokenUsageFromExecute(
  job: JobRecord,
  providerId: string,
  tokenUsage: NonNullable<ExecuteResult['tokenUsage']>,
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

  const projectId = metaString(job, 'projectId')
  const taskId = metaString(job, 'taskId')
  const finishedAt = job.finishedAt || new Date().toISOString()
  const model =
    typeof tokenUsage.model === 'string' && tokenUsage.model.trim()
      ? tokenUsage.model.trim()
      : typeof job.metadata?.model === 'string'
        ? job.metadata.model
        : null

  // Dynamic import avoids circular init with jobQueue.
  const { loadJob, mergeJobUsage, stepIdOf } = await import('./jobQueue.js')
  const snapshot: UsageSnapshot = {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: totalTokens || summed,
    estimatedCostUsd: null,
    model,
    provider: providerId,
    taskId,
    projectId,
    stepId: stepIdOf(job) ?? null,
    phase: metaString(job, 'phase'),
    pipelineId: metaString(job, 'pipelineId'),
    jobId: job.id,
    sessionId,
    startedAt: job.startedAt,
    finishedAt,
    durationMs: durationMsOf(job, finishedAt),
  }
  const cur = loadJob(job.id)
  if (cur) mergeJobUsage(cur.id, snapshot)
  await appendUsageLog({ ...snapshot, source: 'stdout' })
}

/**
 * Capture Claude transcript token delta for a finished job.
 * Prefs `logging.types.usage === false` skips JobRecord + JSONL (least surprise).
 * Never throws to callers — jobQueue invokes fire-and-forget.
 */
export async function captureJobUsage(
  job: JobRecord,
  sessionId: string,
  providerId: string,
): Promise<void> {
  if (providerId !== 'claude-code-cli') return
  if (!isLogTypeEnabled('usage')) return
  if (!sessionId) return

  const projectId = metaString(job, 'projectId')
  const taskId = metaString(job, 'taskId')
  const cursor =
    projectId && taskId
      ? getUsageCursor(projectId, taskId, sessionId) ?? { mainLines: 0, subagentFiles: [] }
      : { mainLines: 0, subagentFiles: [] }

  const mainPath = sessionTranscriptPath(job.workspace, sessionId)
  const main = mainPath ? await readNewUsage(mainPath, cursor.mainLines) : null

  const parts: UsagePart[] = []
  if (main && hasAnyTokens(main.usage)) {
    parts.push({ source: 'main', usage: main.usage, model: main.model })
  }

  const newSubFiles: string[] = []
  const subDir = subagentsDir(job.workspace, sessionId)
  if (subDir) {
    const names = await listNewSubagentFiles(subDir, cursor.subagentFiles)
    for (const name of names) {
      newSubFiles.push(name)
      const abs = resolveSubagentFile(subDir, name)
      if (!abs) continue
      const sub = await readSubagentUsage(abs)
      if (sub && hasAnyTokens(sub.usage)) {
        parts.push({ source: 'subagent', usage: sub.usage, model: sub.model })
      }
    }
  }

  const nextCursor = {
    mainLines: main?.totalLines ?? cursor.mainLines,
    subagentFiles: [...cursor.subagentFiles, ...newSubFiles],
  }

  if (parts.length === 0) {
    if (projectId && taskId) setUsageCursor(projectId, taskId, sessionId, nextCursor)
    return
  }

  const agg = sumTokenUsage(parts.map((p) => p.usage))
  let model: string | null = null
  for (const p of parts) {
    if (p.model) model = p.model
  }

  // Dynamic import avoids circular init with jobQueue (which imports this module).
  const { loadJob, mergeJobUsage, stepIdOf } = await import('./jobQueue.js')

  const finishedAt = job.finishedAt || new Date().toISOString()
  const snapshot: UsageSnapshot = {
    inputTokens: agg.inputTokens,
    outputTokens: agg.outputTokens,
    cacheReadTokens: agg.cacheReadTokens,
    cacheWriteTokens: agg.cacheWriteTokens,
    totalTokens: totalTokensOf(agg),
    estimatedCostUsd: null,
    model,
    provider: providerId,
    taskId,
    projectId,
    stepId: stepIdOf(job) ?? null,
    phase: metaString(job, 'phase'),
    pipelineId: metaString(job, 'pipelineId'),
    jobId: job.id,
    sessionId,
    startedAt: job.startedAt,
    finishedAt,
    durationMs: durationMsOf(job, finishedAt),
  }

  const cur = loadJob(job.id)
  if (cur) mergeJobUsage(cur.id, snapshot)

  await appendUsageLog({ ...snapshot, source: 'aggregate' })

  if (projectId && taskId) setUsageCursor(projectId, taskId, sessionId, nextCursor)
}
