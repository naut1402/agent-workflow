import { ref, watch } from 'vue'
import {
  fetchPipelineProfiles,
  fetchPipelineProfile,
  savePipelineProfile,
  deletePipelineProfile,
} from '../scripts/ProfileManagerApi'

/**
 * State + thao tác CRUD cho pipeline profile của project đang chọn.
 *
 * Tách khỏi component để `EditorTargetPanel` thuần trình bày (không gọi API) và
 * để `PipelineEditor` là nơi duy nhất nạp pipeline vào canvas (qua
 * `applyLoadedPipeline`) — bất biến round-trip phụ thuộc vào điều đó.
 *
 * `load` trả `null` khi lỗi để caller không nạp `undefined` vào canvas; lỗi luôn
 * nằm ở `error` chứ không ném ra ngoài.
 */
export function usePipelineProfiles(getProjectId: () => string | null | undefined) {
  const profiles = ref<any[]>([])
  const loading = ref(false)
  const error = ref('')

  function projectId(): string | undefined {
    return getProjectId() ?? undefined
  }

  async function refresh(): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      const data = await fetchPipelineProfiles(projectId())
      profiles.value = data?.profiles || []
    } catch (e: any) {
      profiles.value = []
      error.value = String(e?.message || e)
    } finally {
      loading.value = false
    }
  }

  async function load(name: string): Promise<unknown | null> {
    if (!name) return null
    loading.value = true
    error.value = ''
    try {
      const data = await fetchPipelineProfile(name, projectId())
      return data?.pipeline ?? null
    } catch (e: any) {
      error.value = String(e?.message || e)
      return null
    } finally {
      loading.value = false
    }
  }

  async function save(name: string, pipeline: unknown): Promise<boolean> {
    loading.value = true
    error.value = ''
    try {
      await savePipelineProfile(name, pipeline, projectId())
      return true
    } catch (e: any) {
      error.value = String(e?.message || e)
      return false
    } finally {
      loading.value = false
    }
  }

  async function remove(name: string): Promise<boolean> {
    loading.value = true
    error.value = ''
    try {
      await deletePipelineProfile(name, projectId())
      return true
    } catch (e: any) {
      error.value = String(e?.message || e)
      return false
    } finally {
      loading.value = false
    }
  }

  // Danh sách profile là per-project — đổi project phải nạp lại.
  watch(() => getProjectId(), () => { refresh() })

  return { profiles, loading, error, refresh, load, save, remove }
}
