import { ref } from 'vue'
import { runArtifactAction } from '../scripts/ArtifactPanelApi'
import { fetchJob } from '../../runner/scripts/runnerApi'
import { t } from '../../../frontend/plugins/i18n'

interface JobLike {
  id?: string
  status?: string
  error?: string
}

export interface ArtifactTarget {
  taskId: string
  name: string
}

export interface PendingApproval {
  jobId: string
  target: ArtifactTarget
}

export interface UseArtifactActionOptions {
  getProjectId: () => string | null
  onReload: (target: ArtifactTarget) => void | Promise<void>
  onAwaitingApproval?: (pending: PendingApproval) => void | Promise<void>
  pollMs?: number
  maxWaitMs?: number
  maxPollErrors?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isTerminal(status?: string): boolean {
  return (
    status === 'succeeded' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'awaiting_approval'
  )
}

function failureMessage(job: JobLike): string {
  if (job.status === 'cancelled') return t('monitor.job.cancelled')
  return job.error
    ? t('monitor.job.failedWithError', { error: job.error })
    : t('monitor.job.failed')
}

export function useArtifactAction(opts: UseArtifactActionOptions) {
  const runningActionId = ref<string | null>(null)
  const runningKey = ref<string | null>(null)
  const error = ref<string | null>(null)
  const lastJobId = ref<string | null>(null)
  const pendingApproval = ref<PendingApproval | null>(null)

  const pollMs = opts.pollMs ?? 1500
  const maxWaitMs = opts.maxWaitMs ?? 5 * 60 * 1000
  const maxPollErrors = opts.maxPollErrors ?? 3

  function targetKey(taskId: string, name: string): string {
    return `${taskId}/${name}`
  }

  async function pollJob(jobId: string): Promise<JobLike> {
    const deadline = Date.now() + maxWaitMs
    let consecutiveErrors = 0
    for (;;) {
      let job: JobLike | undefined
      try {
        const res = await fetchJob(jobId)
        job = res?.job
        consecutiveErrors = 0
      } catch (e) {
        consecutiveErrors += 1
        if (consecutiveErrors > maxPollErrors) throw e
        if (Date.now() >= deadline)
          return { status: 'failed', error: t('monitor.job.timeout') }
        await sleep(pollMs)
        continue
      }
      if (!job) throw new Error(t('monitor.job.missing'))
      if (isTerminal(job.status)) return job
      if (Date.now() >= deadline)
        return { ...job, status: 'failed', error: t('monitor.job.timeout') }
      await sleep(pollMs)
    }
  }

  async function run(
    taskId: string,
    actionId: string,
    artifactName: string,
    runOpts: {
      runnerId?: string
      selectedText?: string
      selectionStartLine?: number
      selectionEndLine?: number
    } = {},
  ) {
    if (runningActionId.value) return
    error.value = null
    runningActionId.value = actionId
    runningKey.value = targetKey(taskId, artifactName)
    try {
      const res = await runArtifactAction(
        {
          taskId,
          actionId,
          artifactName,
          runnerId: runOpts.runnerId,
          selectedText: runOpts.selectedText,
          selectionStartLine: runOpts.selectionStartLine,
          selectionEndLine: runOpts.selectionEndLine,
        },
        opts.getProjectId() ?? undefined,
      )
      const jobId: string | undefined = res?.job?.id
      lastJobId.value = jobId ?? null
      if (!jobId) throw new Error(t('monitor.job.noJobId'))
      const final = await pollJob(jobId)
      if (final.status === 'awaiting_approval') {
        const pending: PendingApproval = { jobId, target: { taskId, name: artifactName } }
        pendingApproval.value = pending
        await opts.onAwaitingApproval?.(pending)
      } else if (final.status === 'succeeded') {
        await opts.onReload({ taskId, name: artifactName })
      } else {
        error.value = failureMessage(final)
      }
    } catch (e: any) {
      error.value = String(e?.message || e)
    } finally {
      runningActionId.value = null
      runningKey.value = null
    }
  }

  function runningActionFor(taskId: string, name: string): string | null {
    return runningKey.value === targetKey(taskId, name) ? runningActionId.value : null
  }

  function clearError() {
    error.value = null
  }

  function clearPendingApproval() {
    pendingApproval.value = null
  }

  return {
    runningActionId,
    runningKey,
    runningActionFor,
    error,
    lastJobId,
    pendingApproval,
    run,
    clearError,
    clearPendingApproval,
  }
}
