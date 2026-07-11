import { ref } from 'vue'
import { runArtifactAction, fetchJob } from '../../../api'

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

export interface UseArtifactActionOptions {
  getProjectId: () => string | null
  // Receives the artifact the job actually ran on so the caller can ignore the
  // reload if the user has since switched to a different artifact.
  onReload: (target: ArtifactTarget) => void | Promise<void>
  pollMs?: number
  maxWaitMs?: number
  // How many consecutive transient poll failures to tolerate before giving up.
  maxPollErrors?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isTerminal(status?: string): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}

function failureMessage(job: JobLike): string {
  if (job.status === 'cancelled') return 'Job đã bị huỷ.'
  return job.error ? `Job thất bại: ${job.error}` : 'Job thất bại.'
}

export function useArtifactAction(opts: UseArtifactActionOptions) {
  const runningActionId = ref<string | null>(null)
  // Identity of the artifact the in-flight job belongs to, so the UI can scope
  // its spinner to the right button when the user switches artifacts mid-run.
  const runningKey = ref<string | null>(null)
  const error = ref<string | null>(null)
  const lastJobId = ref<string | null>(null)

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
        if (Date.now() >= deadline) return { status: 'failed', error: 'Hết thời gian chờ job' }
        await sleep(pollMs)
        continue
      }
      if (!job) throw new Error('Job không tồn tại')
      if (isTerminal(job.status)) return job
      if (Date.now() >= deadline) return { ...job, status: 'failed', error: 'Hết thời gian chờ job' }
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
      if (!jobId) throw new Error('Không nhận được job id từ server')
      const final = await pollJob(jobId)
      if (final.status === 'succeeded') {
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

  return { runningActionId, runningKey, runningActionFor, error, lastJobId, run, clearError }
}
