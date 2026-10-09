import { ref } from 'vue'
import { useApiAction } from '../../../frontend/composables/useApiAction'
import { fetchArtifactActionsCatalog, saveArtifactActionsCatalog } from '../scripts/QuickActionPanelApi'
import { t } from '../../../frontend/plugins/i18n'
import type { ArtifactMenuNode } from '../../monitor/schemas/artifactAction'

// xem docs/architecture/code/quick-action.md §1

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

export function useQuickActionCatalog(_opts?: { getProjectId?: () => string | null }) {
  const version = ref(1)
  const actions = ref<QuickActionDraft[]>([])
  const menus = ref<ArtifactMenuNode[]>([])
  const loading = ref(false)
  const { pending: saving, run: runPersist } = useApiAction()
  const error = ref<string | null>(null)

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const res = await fetchArtifactActionsCatalog()
      version.value = typeof res?.version === 'number' ? res.version : 1
      actions.value = Array.isArray(res?.actions) ? res.actions : []
      menus.value = Array.isArray(res?.menus) ? res.menus : []
    } catch (e: any) {
      error.value = String(e?.message || e)
    } finally {
      loading.value = false
    }
  }

  async function persist(
    nextActions?: QuickActionDraft[],
    nextMenus?: ArtifactMenuNode[],
  ): Promise<boolean> {
    const ok = await runPersist(async () => {
      error.value = null
      const actionsToSave = nextActions ?? actions.value
      const menusToSave = nextMenus ?? menus.value
      try {
        const res = await saveArtifactActionsCatalog({
          version: version.value,
          actions: actionsToSave,
          menus: menusToSave,
        })
        actions.value = Array.isArray(res?.actions) ? res.actions : actionsToSave
        menus.value = Array.isArray(res?.menus) ? res.menus : menusToSave
        return true
      } catch (e: any) {
        error.value = String(e?.message || e)
        return false
      }
    })
    return ok ?? false
  }

  function upsert(draft: QuickActionDraft, editingId: string | null): UpsertResult {
    const id = draft.id.trim()
    if (!id) return { ok: false, error: t('quickAction.errors.idRequired') }
    if (!draft.artifact_patterns.length) return { ok: false, error: t('quickAction.errors.patternRequired') }
    if (!draft.label.trim()) return { ok: false, error: t('quickAction.errors.labelRequired') }
    if (!draft.prompt_template.trim()) return { ok: false, error: t('quickAction.errors.promptRequired') }

    const dupIdx = actions.value.findIndex((a) => a.id === id)
    if (dupIdx >= 0 && actions.value[dupIdx].id !== editingId) {
      return { ok: false, error: t('quickAction.errors.idExists', { id }) }
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

  return { version, actions, menus, loading, saving, error, load, persist, upsert, remove }
}
