import { computed, ref } from 'vue'
import { fetchJobs } from '../../runner/scripts/runnerApi'
import { groupRunningJobs, type JobLite } from '../lib/groupRunningJobs'

export function useRunningJobs(pollMs = 1500) {
  const jobs = ref<JobLite[]>([])
  const error = ref<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false

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
    running = false
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  // Chain via setTimeout (not setInterval) so a poll slower than `pollMs`
  // can't overlap with the next one and have its response race a newer poll's.
  async function scheduleNext() {
    if (!running) return
    await poll()
    if (running) timer = setTimeout(scheduleNext, pollMs)
  }

  function start() {
    stop()
    running = true
    scheduleNext()
  }

  return { jobs, grouped, runningCount, error, poll, start, stop }
}
