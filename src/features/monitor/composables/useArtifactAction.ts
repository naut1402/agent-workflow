import { ref } from 'vue'
import { runArtifactAction, fetchJob } from '../../../api'
import { i18n } from '../../../core/i18n'

// Drives an artifact quick-action end to end: submit the job, poll
// `GET /api/jobs?id=` until it settles, then invoke `onReload` on success so the
// artifact viewer picks up the agent's edits. Kept as a composable so the poll
// loop is unit-testable without rendering.

interface JobLike {
  id?: string
  status?: string
  error?: string
}

export interface ArtifactTarget {
  taskId: string
  name: string
}

// A job that finished against a scratch copy and is waiting for the user to
// review the proposed diff (require_approval quick action). The caller opens the
// review UI keyed by `jobId` and applies/discards from there.
export interface PendingApproval {
  jobId: string
  target: ArtifactTarget
}

export interface UseArtifactActionOptions {
  getProjectId: () => string | null
  // Receives the artifact the job actually ran on so the caller can ignore the
  // reload if the user has since switched to a different artifact.
  onReload: (target: ArtifactTarget) => void | Promise<void>
  // Called when a require_approval job settles at `awaiting_approval` instead of
  // writing to the real file — the caller opens the diff-review UI. When omitted
  // the pending approval is still exposed via the `pendingApproval` ref.
  onAwaitingApproval?: (pending: PendingApproval) => void | Promise<void>
  pollMs?: number
  maxWaitMs?: number
  // How many consecutive transient poll failures to tolerate before giving up.
  maxPollErrors?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// A job stops being polled once it reaches any settled state. `awaiting_approval`
// is a settled state too — the approval-flow job succeeded against its scratch
// copy and is now waiting on the user — NOT a failure and NOT something to keep
// polling until the deadline.
function isTerminal(status?: string): boolean {
  return (
    status === 'succeeded' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'awaiting_approval'
  )
}

function failureMessage(job: JobLike): string {
  if (job.status === 'cancelled') return i18n.global.t('monitor.job.cancelled')
  return job.error
    ? i18n.global.t('monitor.job.failedWithError', { error: job.error })
    : i18n.global.t('monitor.job.failed')
}

export function useArtifactAction(opts: UseArtifactActionOptions) {
  const runningActionId = ref<string | null>(null)
  // Identity of the artifact the in-flight job belongs to, so the UI can scope
  // its spinner to the right button when the user switches artifacts mid-run.
  const runningKey = ref<string | null>(null)
  const error = ref<string | null>(null)
  const lastJobId = ref<string | null>(null)
  // Set when a run settles at `awaiting_approval` — drives the diff-review UI.
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
        // Tolerate transient network/5xx blips instead of failing the whole
        // action on a single hiccup.
        consecutiveErrors += 1
        if (consecutiveErrors > maxPollErrors) throw e
        if (Date.now() >= deadline)
          return { status: 'failed', error: i18n.global.t('monitor.job.timeout') }
        await sleep(pollMs)
        continue
      }
      if (!job) throw new Error(i18n.global.t('monitor.job.missing'))
      if (isTerminal(job.status)) return job
      if (Date.now() >= deadline)
        return { ...job, status: 'failed', error: i18n.global.t('monitor.job.timeout') }
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
      if (!jobId) throw new Error(i18n.global.t('monitor.job.noJobId'))
      const final = await pollJob(jobId)
      if (final.status === 'awaiting_approval') {
        // The agent proposed an edit against a scratch copy; hand off to the
        // review UI instead of reloading (nothing was written yet) or erroring.
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

  // Which action (if any) is running for a given artifact — null when the
  // in-flight job belongs to a different artifact.
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
