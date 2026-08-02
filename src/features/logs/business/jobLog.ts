import { type FSWatcher, joinPath, openFile, stat, watch } from '../../../core/lib/fileHelper.js'
import { registryHome } from '../../../core/registry.js'
import type { JobRecord, JobStatus } from './index.js'
import { loadJob, listJobs } from './index.js'

/**
 * Validate a job id. Job ids are minted with `crypto.randomUUID()`, so a strict
 * UUID shape both matches real ids and rejects path traversal.
 */
export function sanitiseJobId(id: unknown): string | null {
  if (typeof id !== 'string') return null
  const v = id.trim().toLowerCase()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)) return null
  return v
}

const DEFAULT_TAIL_BYTES = 64 * 1024
const DELTA_MAX_BYTES = 256 * 1024
const DEFAULT_WAIT_MS = 0
const MAX_WAIT_MS = 30_000

export type JobLogResult =
  | { ok: true; text: string; size: number; truncated: boolean }
  | { ok: false; status: number; error: string }

export interface JobLogDelta {
  text: string
  from: number
  size: number
  eof: boolean
  reset: boolean
  hasMore: boolean
  status?: JobStatus
  exitCode?: number | null
  jobId?: string
}

export type JobLogDeltaResult =
  | ({ ok: true } & JobLogDelta)
  | { ok: false; status: number; error: string }

function jobLogPath(id: string): string {
  return joinPath(registryHome(), 'jobs', `${id}.log`)
}

const terminalStatuses = new Set<JobStatus>(['succeeded', 'failed', 'cancelled', 'awaiting_approval'])

function isTerminal(status: JobStatus | undefined): boolean {
  return status != null && terminalStatuses.has(status)
}

async function waitForLogGrowth(file: string, offset: number, waitMs: number): Promise<number> {
  if (waitMs <= 0) {
    try {
      return (await stat(file)).size
    } catch {
      return 0
    }
  }

  return new Promise((resolve) => {
    let settled = false
    const finish = async () => {
      if (settled) return
      settled = true
      try {
        watcher?.close()
      } catch {
        /* ignore */
      }
      clearTimeout(timer)
      try {
        resolve((await stat(file)).size)
      } catch {
        resolve(offset)
      }
    }

    const timer = setTimeout(() => {
      finish()
    }, waitMs)

    let watcher: FSWatcher | null = null
    try {
      watcher = watch(file, () => {
        finish()
      })
    } catch {
      finish()
    }
  })
}

export async function readJobLog(
  rawId: unknown,
  tailBytes = DEFAULT_TAIL_BYTES,
): Promise<JobLogResult> {
  const id = sanitiseJobId(rawId)
  if (!id) return { ok: false, status: 400, error: 'invalid job id' }

  const file = jobLogPath(id)
  let handle: Awaited<ReturnType<typeof openFile>> | null = null
  try {
    handle = await openFile(file, 'r')
    const { size } = await handle.stat()
    if (size === 0) return { ok: true, text: '', size: 0, truncated: false }
    const start = size > tailBytes ? size - tailBytes : 0
    const length = size - start
    const buf = Buffer.alloc(length)
    await handle.read(buf, 0, length, start)
    return { ok: true, text: buf.toString('utf8'), size, truncated: start > 0 }
  } catch {
    return { ok: true, text: '', size: 0, truncated: false }
  } finally {
    await handle?.close().catch(() => {})
  }
}

export interface ReadJobLogDeltaOptions {
  offset?: number
  waitMs?: number
}

export async function readJobLogDelta(
  rawId: unknown,
  options: ReadJobLogDeltaOptions = {},
): Promise<JobLogDeltaResult> {
  const id = sanitiseJobId(rawId)
  if (!id) return { ok: false, status: 400, error: 'invalid job id' }

  const job = loadJob(id)
  const offset = Math.max(0, Math.floor(options.offset ?? 0))
  const waitMs = Math.min(MAX_WAIT_MS, Math.max(0, Math.floor(options.waitMs ?? DEFAULT_WAIT_MS)))
  const file = jobLogPath(id)

  let size = 0
  try {
    size = (await stat(file)).size
  } catch {
    size = 0
  }

  if (waitMs > 0 && job && !isTerminal(job.status) && size <= offset) {
    size = await waitForLogGrowth(file, offset, waitMs)
  }

  const reset = size < offset
  const from = reset ? 0 : offset
  const available = Math.max(0, size - from)
  const readLen = Math.min(available, DELTA_MAX_BYTES)
  const hasMore = available > readLen

  let text = ''
  if (readLen > 0) {
    const handle = await openFile(file, 'r')
    try {
      const buf = Buffer.alloc(readLen)
      await handle.read(buf, 0, readLen, from)
      text = buf.toString('utf8')
    } finally {
      await handle.close().catch(() => {})
    }
  }

  const eof = isTerminal(job?.status) && from + readLen >= size

  return {
    ok: true,
    text,
    from,
    size,
    eof,
    reset,
    hasMore,
    status: job?.status,
    exitCode: job?.exitCode ?? null,
    jobId: id,
  }
}

const ACTIVE_PRIORITY: Record<JobStatus, number> = {
  running: 4,
  queued: 3,
  awaiting_approval: 2,
  succeeded: 1,
  failed: 0,
  cancelled: 0,
}

/** Pick the best job for task-level log streaming (running > queued > recent). */
export function resolveTaskJobId(taskId: string): string | null {
  if (!taskId || /[^\w\-]/.test(taskId)) return null
  const matches = listJobs(500).filter((j) => j.metadata?.taskId === taskId)
  if (!matches.length) return null
  matches.sort((a, b) => {
    const pa = ACTIVE_PRIORITY[a.status] ?? 0
    const pb = ACTIVE_PRIORITY[b.status] ?? 0
    if (pb !== pa) return pb - pa
    return (b.createdAt || '').localeCompare(a.createdAt || '')
  })
  return matches[0]?.id ?? null
}

export async function readTaskJobLogDelta(
  taskId: string,
  options: ReadJobLogDeltaOptions = {},
): Promise<JobLogDeltaResult & { jobId?: string }> {
  const jobId = resolveTaskJobId(taskId)
  if (!jobId) {
    return {
      ok: true,
      text: '',
      from: Math.max(0, options.offset ?? 0),
      size: 0,
      eof: true,
      reset: false,
      hasMore: false,
      status: undefined,
      exitCode: null,
      jobId: undefined,
    }
  }
  const r = await readJobLogDelta(jobId, options)
  if (!r.ok) return r
  return { ...r, jobId }
}
