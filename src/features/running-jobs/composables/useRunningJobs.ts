import { computed, ref } from 'vue'
import { fetchJobs } from '../../runner/scripts/runnerApi'
import { groupRunningJobs, type JobLite } from '../lib/groupRunningJobs'

export function useRunningJobs(pollMs = 1500) {
  const jobs = ref<JobLite[]>([])
  const error = ref<string | null>(null)
  let timer: ReturnType<typeof setInterval> | null = null

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
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  function start() {
    stop()
    poll()
    timer = setInterval(poll, pollMs)
  }

  return { jobs, grouped, runningCount, error, poll, start, stop }
}
