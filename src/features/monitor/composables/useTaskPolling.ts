import { ref } from 'vue'
import { fetchTasks } from '../../../api'

// Encapsulates the monitor task-polling loop (root/tasks/selection + connection
// state + the 1500ms interval) so the shell stays thin and the polling logic is
// unit-testable without rendering. `getProjectId` returns the active project id
// (null = default project).
export function useTaskPolling(getProjectId: () => string | null, pollMs = 1500) {
  const root = ref('')
  const tasks = ref<any[]>([])
  const selectedId = ref<string | null>(null)
  const error = ref<string | null>(null)
  const lastUpdated = ref<string | null>(null)
  const connected = ref(false)
  let timer: ReturnType<typeof setInterval> | null = null

  async function poll() {
    try {
      const data = await fetchTasks(getProjectId() ?? undefined)
      root.value = data.root
      tasks.value = data.tasks
      connected.value = true
      error.value = null
      lastUpdated.value = new Date().toLocaleTimeString()
      // Auto-select a task on first load, preferring one needing attention.
      if (!selectedId.value && tasks.value.length) {
        const needsAttention = tasks.value.find((t: any) => t.has_qa || t.hitl_pending)
        selectedId.value = (needsAttention || tasks.value[0]).task_id
      }
    } catch (e: any) {
      connected.value = false
      error.value = String(e.message || e)
    }
  }

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

  return { root, tasks, selectedId, error, lastUpdated, connected, poll, start, stop }
}
