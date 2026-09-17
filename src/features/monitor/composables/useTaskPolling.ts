import { ref } from 'vue'
import { fetchTasks } from '../scripts/monitorApi'
import { openSseStream, type SseStream } from '../../../frontend/lib/sseClient'
import { isFinishedTaskState } from '../lib/pipelineRunGuards'

// Encapsulates the monitor task-list stream (root/tasks/selection + connection
// state) so the shell stays thin and the logic is unit-testable without
// rendering. `getProjectId` returns the active project id (null = default
// project). Backed by SSE (`/api/tasks/stream`) instead of polling — `poll()`
// stays a one-off REST fetch for call sites that need an immediate refresh
// right after their own mutation (create/delete task, switch project).
export function useTaskPolling(getProjectId: () => string | null) {
  const root = ref('')
  const tasks = ref<any[]>([])
  const selectedId = ref<string | null>(null)
  const error = ref<string | null>(null)
  const lastUpdated = ref<string | null>(null)
  const connected = ref(false)
  let stream: SseStream | null = null

  function applyTasks(data: { root: string; tasks: any[] }) {
    root.value = data.root
    tasks.value = data.tasks
    error.value = null
    lastUpdated.value = new Date().toLocaleTimeString()
    // Auto-select a task on first load, preferring one needing attention.
    if (!selectedId.value && tasks.value.length) {
      const needsAttention = tasks.value.find((t: any) => t.has_qa || t.hitl_pending)
      if (needsAttention) {
        selectedId.value = needsAttention.task_id
      } else {
        const candidate = tasks.value.find((t: any) => !isFinishedTaskState(t))
        selectedId.value = candidate ? candidate.task_id : null
      }
    }
  }

  async function poll() {
    try {
      const data = await fetchTasks(getProjectId() ?? undefined)
      applyTasks(data)
    } catch (e: any) {
      error.value = String(e.message || e)
    }
  }

  function stop() {
    stream?.close()
    stream = null
    connected.value = false
  }

  function start() {
    stop()
    stream = openSseStream(
      '/api/tasks/stream',
      { project: getProjectId() ?? undefined },
      {
        onOpen: () => {
          connected.value = true
        },
        onEvent: (type, data) => {
          if (type !== 'tasks') return
          applyTasks(data as { root: string; tasks: any[] })
        },
        onError: (e: any) => {
          connected.value = false
          error.value = String(e?.message || e)
        },
      },
    )
  }

  return { root, tasks, selectedId, error, lastUpdated, connected, poll, start, stop }
}
