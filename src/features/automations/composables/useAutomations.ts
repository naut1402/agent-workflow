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

/**
 * State machine cho AutomationsPanel (#233): list + CRUD + run-now + history,
 * poll nhẹ (10s) để làm mới last-run/next-run khi panel đang mở.
 * Composable thuần (không render) — unit-test được bằng cách mock API script.
 */

const POLL_MS = 10_000

const EMPTY_OPTIONS: AutomationFormOptions = { tasks: [], profiles: [], runners: [], projects: [] }

export function useAutomations(getProjectId: () => string | undefined) {
  const automations = ref<AutomationListItem[]>([])
  const eventTypes = ref<string[]>([])
  /**
   * Options theo project — khoá `''` là project đang chọn (hành vi cũ), các khoá
   * khác là project đích của một bước action runTask.
   */
  const optionsByProject = ref<Record<string, AutomationFormOptions>>({})
  /** Options của project đang chọn — giữ nguyên tên/kiểu cho call site cũ. */
  const formOptions = computed<AutomationFormOptions>(() => optionsByProject.value[''] ?? EMPTY_OPTIONS)
  const loading = ref(false)
  const error = ref('')
  const actionError = ref('')

  /** Lịch sử thực thi toàn project (mọi rule) — tab "Lịch sử thực thi". */
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

  /**
   * Options cho combobox task/profile/runner — load lại mỗi lần mở form.
   * `targetId` rỗng/không truyền = project đang chọn.
   */
  async function loadFormOptions(targetId?: string): Promise<void> {
    const key = (targetId ?? '').trim()
    try {
      const data = await fetchAutomationFormOptions(key || getProjectId())
      optionsByProject.value = { ...optionsByProject.value, [key]: data }
    } catch {
      const next = { ...optionsByProject.value }
      // Không cache kết quả lỗi của project đích: `ensureFormOptions` thấy khoá đã
      // tồn tại là thôi fetch, nên một lần lỗi mạng sẽ làm combobox của project đó
      // rỗng suốt phiên. Khoá '' vẫn ghi rỗng — call site cũ cần giá trị để render.
      if (key) delete next[key]
      else next[key] = { ...EMPTY_OPTIONS }
      optionsByProject.value = next
    }
  }

  /** Nạp options của một project đích nếu chưa có — dialog gọi khi một bước đổi project. */
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

  /** Lịch sử thực thi toàn project (mọi rule) — tab "Lịch sử thực thi". */
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

  // Poll nhẹ theo project — panel mount/unmount điều khiển vòng đời.
  let timer: ReturnType<typeof setInterval> | null = null

  function startPolling(): void {
    stopPolling()
    timer = setInterval(() => {
      void load()
      void loadRuns()
    }, POLL_MS)
  }

  function stopPolling(): void {
    if (timer) clearInterval(timer)
    timer = null
  }

  watch(
    () => getProjectId(),
    () => {
      // Options cũ thuộc project trước — bỏ hết rồi nạp lại ngay khoá project đang
      // chọn: badge "project đích" ở bảng rule cần `projects` để đổi id sang tên,
      // không đợi tới lúc người dùng mở dialog.
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
