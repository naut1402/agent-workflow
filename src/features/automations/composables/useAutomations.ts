import { computed, onUnmounted, ref, watch } from 'vue'
import type { AutomationRun, CreateAutomationRequest, UpdateAutomationRequest } from '../schemas/automation'
import {
  fetchAllAutomationRuns,
  fetchAutomationEventTypes,
  fetchAutomationFormOptions,
  fetchAutomations,
  deleteAutomation,
  createAutomation,
  runAutomationNow,
  toggleAutomation,
  updateAutomation,
  type AutomationFormOptions,
  type AutomationListItem,
} from '../scripts/automationsApi'
import { openSseStream, type SseStream } from '../../../frontend/lib/sseClient'
import { ensureDashboardTransport, isSseEnabled } from '../../../frontend/lib/dashboardTransport'

const POLL_MS = 10_000

const EMPTY_OPTIONS: AutomationFormOptions = { tasks: [], profiles: [], runners: [], projects: [] }

export function useAutomations(getProjectId: () => string | undefined) {
  const automations = ref<AutomationListItem[]>([])
  const eventTypes = ref<string[]>([])
  const optionsByProject = ref<Record<string, AutomationFormOptions>>({})
  const formOptions = computed<AutomationFormOptions>(() => optionsByProject.value[''] ?? EMPTY_OPTIONS)
  const loading = ref(false)
  const error = ref('')
  const actionError = ref('')

  const runs = ref<AutomationRun[]>([])
  const runsLoading = ref(false)
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

  async function loadFormOptions(targetId?: string): Promise<void> {
    const key = (targetId ?? '').trim()
    try {
      const data = await fetchAutomationFormOptions(key || getProjectId())
      optionsByProject.value = { ...optionsByProject.value, [key]: data }
    } catch {
      const next = { ...optionsByProject.value }
      // xem docs/architecture/code/automations.md §4
      if (key) delete next[key]
      else next[key] = { ...EMPTY_OPTIONS }
      optionsByProject.value = next
    }
  }

  async function ensureFormOptions(targetId: string): Promise<void> {
    const key = targetId.trim()
    if (!key || optionsByProject.value[key]) return
    await loadFormOptions(key)
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
      await loadRuns()
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

  async function loadRuns(): Promise<void> {
    runsLoading.value = true
    try {
      const data = await fetchAllAutomationRuns(getProjectId(), 50)
      runs.value = data.runs || []
    } catch {
      runs.value = []
    } finally {
      runsLoading.value = false
    }
  }

  let timer: ReturnType<typeof setInterval> | null = null
  let stream: SseStream | null = null
  let generation = 0

  function startPolling(): void {
    stopPolling()
    const gen = ++generation
    void ensureDashboardTransport().then((transport) => {
      if (gen !== generation) return
      if (isSseEnabled(transport)) {
        stream = openSseStream('/api/automations/stream', { project: getProjectId() }, {
          onEvent: (type, data) => {
            if (gen !== generation || type !== 'automations') return
            const payload = data as { automations?: unknown; runs?: unknown }
            automations.value = Array.isArray(payload.automations) ? (payload.automations as AutomationListItem[]) : []
            runs.value = Array.isArray(payload.runs) ? (payload.runs as AutomationRun[]) : []
          },
        })
        return
      }
      timer = setInterval(() => {
        void load()
        void loadRuns()
      }, POLL_MS)
    })
  }

  function stopPolling(): void {
    generation++
    if (timer) clearInterval(timer)
    timer = null
    stream?.close()
    stream = null
  }

  watch(
    () => getProjectId(),
    () => {
      optionsByProject.value = {}
      void load()
      void loadEventTypes()
      void loadRuns()
      void loadFormOptions()
    },
    { immediate: true },
  )

  onUnmounted(stopPolling)

  return {
    automations: sorted,
    eventTypes,
    formOptions,
    optionsByProject,
    loading,
    error,
    actionError,
    runs,
    runsLoading,
    runningIds,
    load,
    loadEventTypes,
    loadFormOptions,
    ensureFormOptions,
    create,
    update,
    toggle,
    remove,
    runNow,
    loadRuns,
    startPolling,
    stopPolling,
  }
}
