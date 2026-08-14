import { listRecoverEntries, loadRecoverEntry, removeRecoverEntry } from './recoverLedger.js'
import type { JobRecord } from './types.js'
import { emit } from '../../../core/events/index.js'
import { loadRecoverySettings } from '../../settings/business/dashboardSettings.js'
import { resolveRecoveryPollIntervalMs } from '../../settings/schemas/recovery.js'

type RecoverDeps = {
  loadJob: (id: string) => JobRecord | null
  saveJob: (job: JobRecord) => JobRecord
  requeueJob: (id: string) => void
}

let deps: RecoverDeps | null = null
let pollerStarted = false

export function bindRecoverPoller(d: RecoverDeps): void {
  deps = d
}

export async function resumeRecoveredJob(jobId: string): Promise<void> {
  if (!deps) return
  const entry = loadRecoverEntry(jobId)
  if (!entry) return
  if (Date.now() < Date.parse(entry.resumeAfter)) return

  const job = deps.loadJob(jobId)
  if (!job) {
    removeRecoverEntry(jobId)
    return
  }
  if (job.status !== 'awaiting_recovery' && job.status !== 'queued') {
    removeRecoverEntry(jobId)
    return
  }

  removeRecoverEntry(jobId)
  deps.saveJob({
    ...job,
    status: 'queued',
    startedAt: null,
    error: undefined,
    failureKind: undefined,
  })
  deps.requeueJob(jobId)
  emit('job.recovered', {
    jobId,
    kind: entry.kind,
    taskId: job.metadata?.taskId,
    projectId: job.metadata?.projectId,
  })
}

export async function tickRecoverPoller(): Promise<void> {
  for (const entry of listRecoverEntries()) {
    await resumeRecoveredJob(entry.jobId)
  }
}

export function startRecoverPoller(): void {
  if (pollerStarted) return
  pollerStarted = true
  void tickRecoverPoller()
  const intervalMs = resolveRecoveryPollIntervalMs(loadRecoverySettings())
  setInterval(() => {
    void tickRecoverPoller()
  }, intervalMs)
}
