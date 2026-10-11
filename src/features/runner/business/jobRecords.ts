import { joinPath, mkdirSync, readTextFileSync, writeTextFileAtomicSync } from '../../../backend/lib/fileHelper.js'
import { registryHome } from '../../../backend/registry.js'
import type { UsageSnapshot } from '../../../shared/log/schema.js'
import type { JobRecord } from './types.js'

/**
 * `JobRecord` trên đĩa (`<registry home>/jobs/<id>.json`) và cách đọc metadata
 * của nó. Tách khỏi `jobQueue.ts` để `usageCapture.ts` ghi usage lên job mà
 * không phải import ngược `jobQueue` (vòng import).
 */

export function jobsDir(): string {
  return joinPath(registryHome(), 'jobs')
}

function jobFile(id: string): string {
  return joinPath(jobsDir(), `${id}.json`)
}

export function ensureJobsDir(): void {
  mkdirSync(jobsDir(), { recursive: true })
}

export function loadJob(id: string): JobRecord | null {
  try {
    return JSON.parse(readTextFileSync(jobFile(id)))
  } catch {
    return null
  }
}

export function saveJob(job: JobRecord): JobRecord {
  ensureJobsDir()
  writeTextFileAtomicSync(jobFile(job.id), JSON.stringify(job, null, 2))
  return job
}

/** Merge usage onto an existing job record (usage capture path). */
export function mergeJobUsage(id: string, usage: UsageSnapshot): JobRecord | null {
  const cur = loadJob(id)
  if (!cur) return null
  return saveJob({ ...cur, usage })
}

/**
 * The pipeline step a job belongs to. Pipeline run-step jobs tag
 * `pipelineStepId`; ad-hoc/quick-action jobs use `stepId`.
 */
export function stepIdOf(job: JobRecord): string | undefined {
  const meta = job.metadata || {}
  if (typeof meta.stepId === 'string' && meta.stepId) return meta.stepId
  if (typeof meta.pipelineStepId === 'string' && meta.pipelineStepId) return meta.pipelineStepId
  return undefined
}
