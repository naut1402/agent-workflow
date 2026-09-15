import { computed, ref } from 'vue'
import { buildEventSourceUrl } from '../../../core/http/client'
import { fetchJobs } from '../../runner/scripts/runnerApi'
import { groupRunningJobs, type JobLite } from '../lib/groupRunningJobs'

// `_pollMs` no longer drives a client-side interval (server pushes over SSE) —
// kept so callers (`App.vue`) don't need to change their call signature.
export function useRunningJobs(_pollMs = 1500) {
  const jobs = ref<JobLite[]>([])
  const error = ref<string | null>(null)
  let source: EventSource | null = null

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
    source?.close()
    source = null
  }

  function start() {
    stop()
    source = new EventSource(buildEventSourceUrl('/api/jobs/stream'))
    source.addEventListener('jobs', (ev: MessageEvent) => {
      const data = JSON.parse(ev.data)
      jobs.value = Array.isArray(data.jobs) ? (data.jobs as JobLite[]) : []
      error.value = null
    })
    source.onerror = () => {
      error.value = 'connection lost'
      // keep previous jobs — do not clear badge on a single connection drop
    }
  }

  return { jobs, grouped, runningCount, error, poll, start, stop }
}
