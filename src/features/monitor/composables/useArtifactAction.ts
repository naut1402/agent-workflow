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

export interface UseArtifactActionOptions {
  getProjectId: () => string | null
  onReload: () => void | Promise<void>
  pollMs?: number
  maxWaitMs?: number
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
  const error = ref<string | null>(null)
  const lastJobId = ref<string | null>(null)

  const pollMs = opts.pollMs ?? 1500
  const maxWaitMs = opts.maxWaitMs ?? 5 * 60 * 1000

  async function pollJob(jobId: string): Promise<JobLike> {
    const deadline = Date.now() + maxWaitMs
    for (;;) {
      const res = await fetchJob(jobId)
      const job: JobLike | undefined = res?.job
      if (!job) throw new Error('Job không tồn tại')
      if (isTerminal(job.status)) return job
      if (Date.now() >= deadline) return { ...job, status: 'failed', error: 'Hết thời gian chờ job' }
      await sleep(pollMs)
    }
  }

  async function run(taskId: string, actionId: string, artifactName: string, runnerId?: string) {
    if (runningActionId.value) return
    error.value = null
    runningActionId.value = actionId
    try {
      const res = await runArtifactAction(
        { taskId, actionId, artifactName, runnerId },
        opts.getProjectId() ?? undefined,
      )
      const jobId: string | undefined = res?.job?.id
      lastJobId.value = jobId ?? null
      if (!jobId) throw new Error('Không nhận được job id từ server')
      const final = await pollJob(jobId)
      if (final.status === 'succeeded') {
        await opts.onReload()
      } else {
        error.value = failureMessage(final)
      }
    } catch (e: any) {
      error.value = String(e?.message || e)
    } finally {
      runningActionId.value = null
    }
  }

  function clearError() {
    error.value = null
  }

  return { runningActionId, error, lastJobId, run, clearError }
}
