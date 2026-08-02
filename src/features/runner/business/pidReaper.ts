import { joinPath, readTextFileSync, readdirSync, renameSync, writeTextFileSync } from '../../../core/lib/fileHelper.js'
import { registryHome } from '../../../core/registry.js'
import type { JobRecord } from './types.js'

function jobsDir(): string {
  return joinPath(registryHome(), 'jobs')
}

function jobFile(id: string): string {
  return joinPath(jobsDir(), `${id}.json`)
}

/** Best-effort liveness check — `(pid, startedAt)` pair from the job record. */
export function isPidAlive(pid: number | null | undefined): boolean {
  if (pid == null || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function saveJob(job: JobRecord): void {
  const file = jobFile(job.id)
  const tmp = `${file}.tmp`
  writeTextFileSync(tmp, JSON.stringify(job, null, 2), 'utf8')
  renameSync(tmp, file)
}

/**
 * Mark orphaned `running` jobs as failed after a server restart — the child
 * process tree is no longer owned by this process.
 */
export function reapOrphanedRunningJobs(): JobRecord[] {
  let files: string[] = []
  try {
    files = readdirSync(jobsDir()).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }

  const reaped: JobRecord[] = []
  for (const f of files) {
    let job: JobRecord
    try {
      job = JSON.parse(readTextFileSync(joinPath(jobsDir(), f), 'utf8'))
    } catch {
      continue
    }
    if (job.status !== 'running') continue
    if (isPidAlive(job.pid)) continue

    const updated: JobRecord = {
      ...job,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: job.error || 'orphaned running job (process no longer alive)',
      pid: null,
    }
    saveJob(updated)
    reaped.push(updated)
  }
  return reaped
}
