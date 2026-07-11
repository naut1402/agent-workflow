import { ref } from 'vue'
import { fetchArtifactActionsCatalog, saveArtifactActionsCatalog } from '../../../api'

// Drives the QuickAction CRUD panel: loads the full artifact-actions catalog
// (`GET /api/artifact-actions` without `?artifact=`), lets the caller
// upsert/remove entries in local state, then persists the whole array back
// via `PUT /api/artifact-actions` (full-catalog replace — the server is the
// schema source of truth, this composable only does cheap client-side
// uniqueness/required-field checks before sending).

export interface QuickActionDraft {
  id: string
  label: string
  artifact_patterns: string[]
  agent_ref: string
  prompt_template: string
  produces: string[]
  confirm: boolean
  attach_points: string[]
  runner_id?: string
  // When true the action runs against a scratch copy and the user reviews the
  // proposed diff before it's written to the real artifact (approval flow).
  require_approval?: boolean
  [key: string]: unknown
}

export type UpsertResult = { ok: true } | { ok: false; error: string }

export function useQuickActionCatalog(opts: { getProjectId: () => string | null }) {
  const version = ref(1)
  const actions = ref<QuickActionDraft[]>([])
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const res = await fetchArtifactActionsCatalog(opts.getProjectId() ?? undefined)
      version.value = typeof res?.version === 'number' ? res.version : 1
      actions.value = Array.isArray(res?.actions) ? res.actions : []
    } catch (e: any) {
      error.value = String(e?.message || e)
    } finally {
      loading.value = false
    }
  }

  async function persist(next: QuickActionDraft[]): Promise<boolean> {
    saving.value = true
    error.value = null
    try {
      const res = await saveArtifactActionsCatalog(
        { version: version.value, actions: next },
        opts.getProjectId() ?? undefined,
      )
      actions.value = Array.isArray(res?.actions) ? res.actions : next
      return true
    } catch (e: any) {
      error.value = String(e?.message || e)
      return false
    } finally {
      saving.value = false
    }
  }

  /** Validate + insert/replace a draft by id in local state (does not save). */
  function upsert(draft: QuickActionDraft, editingId: string | null): UpsertResult {
    const id = draft.id.trim()
    if (!id) return { ok: false, error: 'id không được để trống' }
    if (!draft.artifact_patterns.length) return { ok: false, error: 'cần ít nhất 1 artifact pattern' }
    if (!draft.label.trim()) return { ok: false, error: 'label không được để trống' }
    if (!draft.prompt_template.trim()) return { ok: false, error: 'prompt_template không được để trống' }

    const dupIdx = actions.value.findIndex((a) => a.id === id)
    if (dupIdx >= 0 && actions.value[dupIdx].id !== editingId) {
      return { ok: false, error: `id "${id}" đã tồn tại` }
    }

    const editIdx = editingId ? actions.value.findIndex((a) => a.id === editingId) : -1
    const normalized: QuickActionDraft = { ...draft, id }
    if (editIdx >= 0) actions.value.splice(editIdx, 1, normalized)
    else actions.value.push(normalized)
    return { ok: true }
  }

  function remove(id: string): void {
    actions.value = actions.value.filter((a) => a.id !== id)
  }

  return { version, actions, loading, saving, error, load, persist, upsert, remove }
}
