import { ref } from 'vue'
import { buildEventSourceUrl } from '../../../core/http/client'
import { fetchTasks } from '../scripts/monitorApi'

// Encapsulates the monitor task feed (root/tasks/selection + connection state)
// so the shell stays thin and the logic is unit-testable without rendering.
// `start()`/`stop()` open/close an SSE connection to `/api/tasks/stream`
// (server pushes on `.dev-state/` change, debounced); `poll()` stays a plain
// REST round-trip for the manual refresh button. `getProjectId` returns the
// active project id (null = default project).
// `_pollMs` no longer drives a client-side interval (server pushes over SSE) —
// kept so callers (`App.vue`) don't need to change their call signature.
export function useTaskPolling(getProjectId: () => string | null, _pollMs = 1500) {
  const root = ref('')
  const tasks = ref<any[]>([])
  const selectedId = ref<string | null>(null)
  const error = ref<string | null>(null)
  const lastUpdated = ref<string | null>(null)
  const connected = ref(false)
  let source: EventSource | null = null

  function applyTasks(data: { root: string; tasks: any[] }) {
    root.value = data.root
    tasks.value = data.tasks
    lastUpdated.value = new Date().toLocaleTimeString()
    // Auto-select a task on first load, preferring one needing attention.
    if (!selectedId.value && tasks.value.length) {
      const needsAttention = tasks.value.find((t: any) => t.has_qa || t.hitl_pending)
      selectedId.value = (needsAttention || tasks.value[0]).task_id
    }
  }

  async function poll() {
    try {
      const data = await fetchTasks(getProjectId() ?? undefined)
      applyTasks(data)
      connected.value = true
      error.value = null
    } catch (e: any) {
      connected.value = false
      error.value = String(e.message || e)
    }
  }

  function stop() {
    source?.close()
    source = null
  }

  function start() {
    stop()
    source = new EventSource(buildEventSourceUrl('/api/tasks/stream', { project: getProjectId() }))
    source.addEventListener('tasks', (ev: MessageEvent) => {
      applyTasks(JSON.parse(ev.data))
      connected.value = true
      error.value = null
    })
    source.onerror = () => {
      connected.value = false
    }
  }

  return { root, tasks, selectedId, error, lastUpdated, connected, poll, start, stop }
}
