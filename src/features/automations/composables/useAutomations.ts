import { computed, onUnmounted, ref, watch } from 'vue'
import type { AutomationRun, CreateAutomationRequest, UpdateAutomationRequest } from '../schemas/automation'
import {
  fetchAutomationEventTypes,
  fetchAutomationRuns,
  fetchAutomations,
  deleteAutomation,
  createAutomation,
  runAutomationNow,
  toggleAutomation,
  updateAutomation,
  type AutomationListItem,
} from '../scripts/automationsApi'

/**
 * State machine cho AutomationsPanel (#233): list + CRUD + run-now + history,
 * poll nhẹ (10s) để làm mới last-run/next-run khi panel đang mở.
 * Composable thuần (không render) — unit-test được bằng cách mock API script.
 */

const POLL_MS = 10_000

export function useAutomations(getProjectId: () => string | undefined) {
  const automations = ref<AutomationListItem[]>([])
  const eventTypes = ref<string[]>([])
  const loading = ref(false)
  const error = ref('')
  const actionError = ref('')

  /** Rule đang mở history (id) + runs tương ứng. */
  const historyFor = ref<string | null>(null)
  const historyRuns = ref<AutomationRun[]>([])
  const historyLoading = ref(false)
  const runningIds = ref<Set<string>>(new Set())

  const sorted = computed(() => [...automations.value].sort((a, b) => a.name.localeCompare(b.name)))

  async function load(): Promise<void> {
    loading.value = true
    try {
      const data = await fetchAutomations(getProjectId())
      automations.value = data.automations || []
      error.value = ''
    } catch (e: any) {
      error.value = String(e?.message || e)
    } finally {
      loading.value = false
    }
  }

  async function loadEventTypes(): Promise<void> {
    if (eventTypes.value.length) return
    try {
      const data = await fetchAutomationEventTypes(getProjectId())
      eventTypes.value = data.types || []
    } catch {
      /* dropdown rỗng — form vẫn gõ tay được */
    }
  }

  async function create(payload: CreateAutomationRequest): Promise<boolean> {
    actionError.value = ''
    try {
      await createAutomation(payload, getProjectId())
      await load()
      return true
    } catch (e: any) {
      actionError.value = String(e?.message || e)
      return false
    }
  }

  async function update(id: string, payload: UpdateAutomationRequest): Promise<boolean> {
    actionError.value = ''
    try {
      await updateAutomation(id, payload, getProjectId())
      await load()
      return true
    } catch (e: any) {
      actionError.value = String(e?.message || e)
      return false
    }
  }

  async function toggle(id: string, enabled: boolean): Promise<void> {
    actionError.value = ''
    try {
      await toggleAutomation(id, enabled, getProjectId())
      await load()
    } catch (e: any) {
      actionError.value = String(e?.message || e)
    }
  }

  async function remove(id: string): Promise<void> {
    actionError.value = ''
    try {
      await deleteAutomation(id, getProjectId())
      if (historyFor.value === id) {
        historyFor.value = null
        historyRuns.value = []
      }
      await load()
    } catch (e: any) {
      actionError.value = String(e?.message || e)
    }
  }

  async function runNow(id: string): Promise<AutomationRun | null> {
    actionError.value = ''
    runningIds.value = new Set([...runningIds.value, id])
    try {
      const data = await runAutomationNow(id, getProjectId())
      await load()
      if (historyFor.value === id) await loadHistory(id)
      return data.run
    } catch (e: any) {
      actionError.value = String(e?.message || e)
      return null
    } finally {
      const next = new Set(runningIds.value)
      next.delete(id)
      runningIds.value = next
    }
  }

  async function loadHistory(id: string): Promise<void> {
    historyLoading.value = true
    try {
      const data = await fetchAutomationRuns(id, getProjectId(), 20)
      historyRuns.value = data.runs || []
    } catch {
      historyRuns.value = []
    } finally {
      historyLoading.value = false
    }
  }

  async function toggleHistory(id: string): Promise<void> {
    if (historyFor.value === id) {
      historyFor.value = null
      historyRuns.value = []
      return
    }
    historyFor.value = id
    await loadHistory(id)
  }

  // Poll nhẹ theo project — panel mount/unmount điều khiển vòng đời.
  let timer: ReturnType<typeof setInterval> | null = null

  function startPolling(): void {
    stopPolling()
    timer = setInterval(() => {
      void load()
    }, POLL_MS)
  }

  function stopPolling(): void {
    if (timer) clearInterval(timer)
    timer = null
  }

  watch(
    () => getProjectId(),
    () => {
      void load()
      void loadEventTypes()
    },
    { immediate: true },
  )

  onUnmounted(stopPolling)

  return {
    automations: sorted,
    eventTypes,
    loading,
    error,
    actionError,
    historyFor,
    historyRuns,
    historyLoading,
    runningIds,
    load,
    loadEventTypes,
    create,
    update,
    toggle,
    remove,
    runNow,
    toggleHistory,
    startPolling,
    stopPolling,
  }
}
