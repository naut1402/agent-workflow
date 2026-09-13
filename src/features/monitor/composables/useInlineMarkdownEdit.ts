import { ref, nextTick, type ComponentPublicInstance, type Ref } from 'vue'
import { splitMarkdownSections, joinMarkdownSections } from '../../../frontend/lib/markdownSections'

export type EditSection = 'full' | number

/** Focusable edit target (e.g. MarkdownTextEditor expose). */
export type FocusableEditTarget = { focus(): void }

/** VNodeRef-compatible binder for MarkdownTextEditor (and similar) exposes. */
export function bindFocusableEditRef(
  target: Ref<FocusableEditTarget | null>,
): (el: Element | ComponentPublicInstance | null) => void {
  return (el) => {
    const candidate = el as unknown as FocusableEditTarget | null
    target.value =
      candidate != null && typeof candidate.focus === 'function' ? candidate : null
  }
}

// Hai hàm thuần đã chuyển sang `frontend/lib/markdownSections` (tầng dưới, dùng
// chung với agent-editor). Re-export để mọi import cũ qua composable này giữ
// nguyên đường dẫn.
export { splitMarkdownSections, joinMarkdownSections }

export function useInlineMarkdownEdit(options: {
  getContent: () => string
  setContent: (value: string) => void
  onSave: (content: string) => Promise<void>
}) {
  const editingSection = ref<EditSection | null>(null)
  const sectionDraft = ref('')
  const saving = ref(false)
  const savedSection = ref<EditSection | null>(null)
  const editTextarea = ref<FocusableEditTarget | null>(null)
  let saveIndicatorTimer: ReturnType<typeof setTimeout> | null = null

  function flashSaved(section: EditSection) {
    savedSection.value = section
    if (saveIndicatorTimer) clearTimeout(saveIndicatorTimer)
    saveIndicatorTimer = setTimeout(() => {
      if (savedSection.value === section) savedSection.value = null
    }, 2500)
  }

  function showSavingIndicator(section: EditSection) {
    return saving.value && editingSection.value === section
  }

  function showSavedIndicator(section: EditSection) {
    return !saving.value && savedSection.value === section
  }

  function getSectionSource(section: EditSection): string {
    if (section === 'full') return options.getContent()
    const parts = splitMarkdownSections(options.getContent())
    return parts[section] ?? ''
  }

  function applyDraft(section: EditSection, draft: string): string {
    if (section === 'full') return draft
    const parts = splitMarkdownSections(options.getContent())
    if (section >= parts.length) return options.getContent()
    parts[section] = draft
    return joinMarkdownSections(parts)
  }

  function shouldIgnoreClick(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null
    if (!el) return false
    return Boolean(
      el.closest(
        'a, button, summary, input, textarea, select, .mermaid, .toastui-editor-defaultUI',
      ),
    )
  }

  function startEdit(section: EditSection = 'full', e?: MouseEvent) {
    if (saving.value) return
    if (e && shouldIgnoreClick(e.target)) return
    editingSection.value = section
    sectionDraft.value = getSectionSource(section)
    nextTick(() => editTextarea.value?.focus())
  }

  function cancelEdit() {
    editingSection.value = null
    sectionDraft.value = ''
    if (saveIndicatorTimer) {
      clearTimeout(saveIndicatorTimer)
      saveIndicatorTimer = null
    }
    savedSection.value = null
  }

  async function onBlur() {
    if (editingSection.value === null || saving.value) return
    const section = editingSection.value
    const current = getSectionSource(section)
    if (sectionDraft.value === current) {
      editingSection.value = null
      return
    }
    const nextContent = applyDraft(section, sectionDraft.value)
    saving.value = true
    try {
      await options.onSave(nextContent)
      flashSaved(section)
      editingSection.value = null
    } catch (e) {
      saving.value = false
      throw e
    }
    saving.value = false
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') cancelEdit()
  }

  const isEditing = () => editingSection.value !== null

  return {
    editingSection,
    sectionDraft,
    saving,
    savedSection,
    editTextarea,
    startEdit,
    cancelEdit,
    onBlur,
    onKeydown,
    isEditing,
    showSavingIndicator,
    showSavedIndicator,
  }
}
