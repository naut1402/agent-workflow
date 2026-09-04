import { readTextFile, statSafe } from '../../../core/lib/fileHelper.js'
import { logFile } from '../../../core/log/fileDriver.js'
import { isLogTypeEnabled } from '../../../core/log/loggingPrefsIo.js'
import { parseLogLine, type UsageLogEntry } from '../../../core/log/schema.js'
import type {
  UsageGroup,
  UsageGroupBy,
  UsageStatsQuery,
  UsageStatsResult,
  UsageTotals,
} from '../schemas/usageStats.js'

/**
 * Aggregation token usage cho mode Thống kê (issue #231). Đọc `usage.jsonl`
 * defensive (file thiếu / dòng hỏng → bỏ qua, không throw) rồi group/sum theo
 * dimension có sẵn trên `UsageLogEntry` (projectId/taskId/stepId/jobId/…).
 *
 * `readUsageEntries()` là ĐƠN VỊ ĐỌC duy nhất của feature: khi PR #229 (SQLite
 * log backend) merge, nhánh fast-path SQL cắm tại đây mà không sửa
 * controller/UI — bên ngoài vẫn thấy mảng entry như cũ.
 */

/** Số group tối đa trả về — tránh xychart/pie nổ khi có hàng trăm task/job. */
export const MAX_GROUPS = 200

let entryCache: { mtime: number; size: number; entries: UsageLogEntry[] } | null = null

/** Clear cached stat signature — dùng cho test isolation giữa các case ghi file liên tiếp. */
export function resetUsageStatsCacheForTest(): void {
  entryCache = null
}

/** Đọc toàn bộ usage entries (mọi project) — lọc theo project làm ở tầng aggregate. */
export async function readUsageEntries(): Promise<UsageLogEntry[]> {
  if (!isLogTypeEnabled('usage')) return []

  const file = logFile('usage')
  const info = await statSafe(file)

  if (!info.exists) {
    entryCache = null
    return []
  }

  if (entryCache && entryCache.mtime === info.mtime && entryCache.size === info.size) {
    return entryCache.entries
  }

  const entries: UsageLogEntry[] = []
  try {
    const raw = await readTextFile(file)
    for (const line of raw.split('\n')) {
      const entry = parseLogLine(line)
      if (entry && entry.type === 'usage') entries.push(entry)
    }
  } catch {
    // File chưa tồn tại / đọc lỗi → empty (bất biến đọc phòng thủ).
    entryCache = null
    return []
  }

  entryCache = { mtime: info.mtime!, size: info.size, entries }
  return entries
}

/** Chuyển `from`/`to` (ISO hoặc epoch-ms) sang ms; null khi không parse được. */
export function parseTimeBoundMs(value: string): number | null {
  if (/^\d{10,}$/.test(value)) return Number(value)
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

function groupKeyOf(entry: UsageLogEntry, groupBy: UsageGroupBy): string {
  switch (groupBy) {
    case 'project':
      return entry.projectId ?? ''
    case 'task':
      return entry.taskId ?? ''
    case 'step':
      return entry.stepId ?? ''
    case 'job':
      return entry.jobId ?? ''
    case 'model':
      return entry.model ?? ''
    case 'provider':
      return entry.provider ?? ''
    case 'source':
      return entry.source ?? ''
    case 'date':
      // Bucket UTC `YYYY-MM-DD` — deterministic, không lệch theo TZ server.
      return new Date(entry.ts).toISOString().slice(0, 10)
  }
}

function emptyAccumulator(key: string) {
  return {
    key,
    entries: 0,
    jobs: new Set<string>(),
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    durationMs: 0,
    firstTs: Number.POSITIVE_INFINITY,
    lastTs: Number.NEGATIVE_INFINITY,
    // Mốc min/max/avg theo từng entry — min/max để POSITIVE/NEGATIVE_INFINITY
    // làm sentinel; durationMs null được map riêng (entry không có duration).
    minTotalTokens: Number.POSITIVE_INFINITY,
    maxTotalTokens: 0,
    minDurationMs: Number.POSITIVE_INFINITY,
    maxDurationMs: 0,
    durationCount: 0,
  }
}

type Accumulator = ReturnType<typeof emptyAccumulator>

function accumulate(acc: Accumulator, entry: UsageLogEntry): void {
  acc.entries += 1
  acc.jobs.add(entry.jobId)
  acc.inputTokens += entry.inputTokens
  acc.outputTokens += entry.outputTokens
  acc.cacheReadTokens += entry.cacheReadTokens ?? 0
  acc.cacheWriteTokens += entry.cacheWriteTokens ?? 0
  acc.totalTokens += entry.totalTokens
  acc.minTotalTokens = Math.min(acc.minTotalTokens, entry.totalTokens)
  acc.maxTotalTokens = Math.max(acc.maxTotalTokens, entry.totalTokens)
  if (entry.durationMs != null) {
    acc.durationMs += entry.durationMs
    acc.minDurationMs = Math.min(acc.minDurationMs, entry.durationMs)
    acc.maxDurationMs = Math.max(acc.maxDurationMs, entry.durationMs)
    acc.durationCount += 1
  }
  acc.firstTs = Math.min(acc.firstTs, entry.ts)
  acc.lastTs = Math.max(acc.lastTs, entry.ts)
}

function finalize(acc: Accumulator): UsageGroup {
  const hasDuration = acc.durationCount > 0
  return {
    key: acc.key,
    entries: acc.entries,
    jobs: acc.jobs.size,
    inputTokens: acc.inputTokens,
    outputTokens: acc.outputTokens,
    cacheReadTokens: acc.cacheReadTokens,
    cacheWriteTokens: acc.cacheWriteTokens,
    totalTokens: acc.totalTokens,
    durationMs: acc.durationMs,
    firstTs: Number.isFinite(acc.firstTs) ? acc.firstTs : 0,
    lastTs: Number.isFinite(acc.lastTs) ? acc.lastTs : 0,
    minTotalTokens: acc.minTotalTokens,
    maxTotalTokens: acc.maxTotalTokens,
    avgTotalTokens: acc.entries ? acc.totalTokens / acc.entries : 0,
    minDurationMs: hasDuration ? acc.minDurationMs : null,
    maxDurationMs: hasDuration ? acc.maxDurationMs : null,
    avgDurationMs: hasDuration ? acc.durationMs / acc.durationCount : null,
  }
}

function totalsOf(accs: Accumulator[]): UsageTotals {
  const total = accumulateAll(accs)
  const hasDuration = total.durationCount > 0
  return {
    entries: total.entries,
    jobs: countDistinctJobs(accs),
    inputTokens: total.inputTokens,
    outputTokens: total.outputTokens,
    cacheReadTokens: total.cacheReadTokens,
    cacheWriteTokens: total.cacheWriteTokens,
    totalTokens: total.totalTokens,
    durationMs: total.durationMs,
    firstTs: Number.isFinite(total.firstTs) ? total.firstTs : null,
    lastTs: Number.isFinite(total.lastTs) ? total.lastTs : null,
    // Entry-level: min/max gộp từ các group, avg chia trên TOÀN bộ entry.
    // accs rỗng → sentinel Infinity về 0.
    minTotalTokens: Number.isFinite(total.minTotalTokens) ? total.minTotalTokens : 0,
    maxTotalTokens: total.maxTotalTokens,
    avgTotalTokens: total.entries ? total.totalTokens / total.entries : 0,
    minDurationMs: hasDuration ? total.minDurationMs : null,
    maxDurationMs: hasDuration ? total.maxDurationMs : null,
    avgDurationMs: hasDuration ? total.durationMs / total.durationCount : null,
  }
}

function accumulateAll(accs: Accumulator[]): Accumulator {
  const total = emptyAccumulator('')
  for (const acc of accs) {
    total.entries += acc.entries
    total.inputTokens += acc.inputTokens
    total.outputTokens += acc.outputTokens
    total.cacheReadTokens += acc.cacheReadTokens
    total.cacheWriteTokens += acc.cacheWriteTokens
    total.totalTokens += acc.totalTokens
    total.durationMs += acc.durationMs
    total.durationCount += acc.durationCount
    total.minTotalTokens = Math.min(total.minTotalTokens, acc.minTotalTokens)
    total.maxTotalTokens = Math.max(total.maxTotalTokens, acc.maxTotalTokens)
    total.minDurationMs = Math.min(total.minDurationMs, acc.minDurationMs)
    total.maxDurationMs = Math.max(total.maxDurationMs, acc.maxDurationMs)
    total.firstTs = Math.min(total.firstTs, acc.firstTs)
    total.lastTs = Math.max(total.lastTs, acc.lastTs)
  }
  return total
}

function countDistinctJobs(accs: Accumulator[]): number {
  const jobs = new Set<string>()
  for (const acc of accs) for (const id of acc.jobs) jobs.add(id)
  return jobs.size
}

/** Pure aggregation — test được không cần fs. */
export function aggregateUsage(
  entries: UsageLogEntry[],
  opts: {
    groupBy: UsageGroupBy
    project?: string
    taskId?: string
    stepId?: string
    fromMs?: number
    toMs?: number
  },
): UsageStatsResult {
  const byKey = new Map<string, Accumulator>()
  for (const entry of entries) {
    if (opts.project !== undefined && (entry.projectId ?? '') !== opts.project) continue
    if (opts.taskId !== undefined && (entry.taskId ?? '') !== opts.taskId) continue
    if (opts.stepId !== undefined && (entry.stepId ?? '') !== opts.stepId) continue
    if (opts.fromMs !== undefined && entry.ts < opts.fromMs) continue
    if (opts.toMs !== undefined && entry.ts > opts.toMs) continue
    const key = groupKeyOf(entry, opts.groupBy)
    let acc = byKey.get(key)
    if (!acc) {
      acc = emptyAccumulator(key)
      byKey.set(key, acc)
    }
    accumulate(acc, entry)
  }

  const all = [...byKey.values()]
  // `date` giữ thứ tự thời gian tăng dần cho line chart; dimension khác thì
  // giảm dần theo totalTokens (group "nặng nhất" lên đầu bảng + biểu đồ).
  if (opts.groupBy === 'date') all.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  else all.sort((a, b) => b.totalTokens - a.totalTokens)

  const truncated = all.length > MAX_GROUPS
  const kept = truncated ? all.slice(0, MAX_GROUPS) : all
  return {
    groupBy: opts.groupBy,
    groups: kept.map(finalize),
    truncated,
    totals: totalsOf(all),
  }
}

/** Đọc (cache theo mtime/size file) + filter + aggregate theo query đã validate. */
export async function getUsageStats(
  query: UsageStatsQuery,
  bounds: { fromMs?: number; toMs?: number } = {},
): Promise<UsageStatsResult> {
  const entries = await readUsageEntries()
  return aggregateUsage(entries, {
    groupBy: query.groupBy,
    project: query.project,
    taskId: query.taskId,
    stepId: query.stepId,
    fromMs: bounds.fromMs,
    toMs: bounds.toMs,
  })
}
