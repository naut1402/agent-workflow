/**
 * Token usage ledger + heuristic estimate (Epic G).
 */

import { joinPath, mkdirSync, readTextFileSync, renameSync, writeTextFileSync } from '../../../core/lib/fileHelper.js'
import { registryHome } from '../../../core/registry.js'
import { emit } from '../../../core/events/index.js'

export type UsageMode = 'observe' | 'warn' | 'block'

export interface UsageRecord {
  at: string
  jobId?: string
  projectId?: string
  taskId?: string
  runnerId?: string
  providerId?: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimated: boolean
}

export interface UsageStore {
  version: 1
  mode: UsageMode
  /** Soft limit for warn/block (total tokens per day). 0 = unlimited. */
  dailyLimit: number
  records: UsageRecord[]
}

function usageFile(): string {
  return joinPath(registryHome(), 'token-usage.json')
}

function emptyStore(): UsageStore {
  return { version: 1, mode: 'observe', dailyLimit: 0, records: [] }
}

export function loadUsageStore(): UsageStore {
  try {
    const raw = readTextFileSync(usageFile())
    const data = JSON.parse(raw) as UsageStore
    if (!data || data.version !== 1 || !Array.isArray(data.records)) return emptyStore()
    return {
      version: 1,
      mode: data.mode === 'warn' || data.mode === 'block' ? data.mode : 'observe',
      dailyLimit: Number(data.dailyLimit) > 0 ? Number(data.dailyLimit) : 0,
      records: data.records.slice(-5000),
    }
  } catch {
    return emptyStore()
  }
}

export function saveUsageStore(store: UsageStore): void {
  const home = registryHome()
  mkdirSync(home, { recursive: true })
  const file = usageFile()
  const tmp = `${file}.tmp`
  writeTextFileSync(tmp, JSON.stringify(store, null, 2))
  renameSync(tmp, file)
}

/** ~4 chars per token heuristic (plan / prompt estimate). */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length / 4))
}

export function todayUtcPrefix(): string {
  return new Date().toISOString().slice(0, 10)
}

export function sumTodayTokens(store: UsageStore = loadUsageStore()): number {
  const day = todayUtcPrefix()
  let sum = 0
  for (const r of store.records) {
    if (r.at.startsWith(day)) sum += r.totalTokens || 0
  }
  return sum
}

export interface RecordUsageInput {
  jobId?: string
  projectId?: string
  taskId?: string
  runnerId?: string
  providerId?: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  estimated?: boolean
}

export function recordUsage(input: RecordUsageInput): UsageRecord {
  const store = loadUsageStore()
  const inputTokens = input.inputTokens ?? 0
  const outputTokens = input.outputTokens ?? 0
  const totalTokens = input.totalTokens ?? inputTokens + outputTokens
  const rec: UsageRecord = {
    at: new Date().toISOString(),
    jobId: input.jobId,
    projectId: input.projectId,
    taskId: input.taskId,
    runnerId: input.runnerId,
    providerId: input.providerId,
    inputTokens,
    outputTokens,
    totalTokens,
    estimated: Boolean(input.estimated),
  }
  store.records.push(rec)
  if (store.records.length > 5000) store.records = store.records.slice(-5000)
  saveUsageStore(store)
  emit('usage.recorded', { ...rec })
  return rec
}

export function setUsageMode(mode: UsageMode, dailyLimit?: number): UsageStore {
  const store = loadUsageStore()
  store.mode = mode
  if (dailyLimit != null && dailyLimit >= 0) store.dailyLimit = dailyLimit
  saveUsageStore(store)
  return store
}

export type UsageGate = { ok: true } | { ok: false; reason: string; mode: UsageMode }

/** Check estimate against daily limit before submit (warn/block modes). */
export function checkUsageGate(estimatedTotal: number): UsageGate {
  const store = loadUsageStore()
  if (store.mode === 'observe' || store.dailyLimit <= 0) return { ok: true }
  const used = sumTodayTokens(store)
  if (used + estimatedTotal <= store.dailyLimit) return { ok: true }
  const reason = `Daily token limit ${store.dailyLimit} would be exceeded (used ${used}, estimate ${estimatedTotal})`
  if (store.mode === 'warn') return { ok: true } // warn is soft — caller may surface reason
  return { ok: false, reason, mode: store.mode }
}

export function aggregateUsage(opts: { projectId?: string; taskId?: string } = {}): {
  mode: UsageMode
  dailyLimit: number
  todayTotal: number
  total: number
  records: UsageRecord[]
} {
  const store = loadUsageStore()
  let records = store.records
  if (opts.projectId) records = records.filter((r) => r.projectId === opts.projectId)
  if (opts.taskId) records = records.filter((r) => r.taskId === opts.taskId)
  const total = records.reduce((s, r) => s + (r.totalTokens || 0), 0)
  return {
    mode: store.mode,
    dailyLimit: store.dailyLimit,
    todayTotal: sumTodayTokens(store),
    total,
    records: records.slice(-200),
  }
}
