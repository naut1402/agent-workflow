import { computed, ref } from 'vue'
import { fetchJobs } from '../../runner/scripts/runnerApi'
import { groupRunningJobs, type JobLite } from '../lib/groupRunningJobs'
import { openSseStream, type SseStream } from '../../../frontend/lib/sseClient'

// Backed by SSE (`/api/jobs/stream`, global — không scope theo project) thay
// vì polling. `poll()` giữ lại là 1 lần fetch REST cho call site cần refresh
// ngay sau hành động của chính user.
export function useRunningJobs() {
  const jobs = ref<JobLite[]>([])
  const error = ref<string | null>(null)
  let stream: SseStream | null = null

  async function poll() {
    try {
      const data = await fetchJobs({ status: 'running' })
      jobs.value = Array.isArray(data.jobs) ? (data.jobs as JobLite[]) : []
      error.value = null
    } catch (e: any) {
      error.value = String(e.message || e)
      // keep previous jobs — do not clear badge on a single poll failure
    }
  }

  const grouped = computed(() => groupRunningJobs(jobs.value))
  const runningCount = computed(() => grouped.value.totalJobs)

  function stop() {
    stream?.close()
    stream = null
  }

  function start() {
    stop()
    stream = openSseStream('/api/jobs/stream', undefined, {
      onEvent: (type, data) => {
        if (type !== 'jobs') return
        const jobsData = (data as { jobs: unknown }).jobs
        jobs.value = Array.isArray(jobsData) ? (jobsData as JobLite[]) : []
        error.value = null
      },
      onError: (e: any) => {
        error.value = String(e?.message || e)
        // keep previous jobs — do not clear badge on a single stream failure
      },
    })
  }

  return { jobs, grouped, runningCount, error, poll, start, stop }
}
