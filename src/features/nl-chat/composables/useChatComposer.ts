import { computed, nextTick, ref, type Ref } from 'vue'
import { useChatAttachments } from './useChatAttachments'
import { appendAttachments } from '../lib/attachmentPrompt'
import { appendKnowledge } from '../lib/knowledgePrompt'
import { fetchKnowledgeBundle } from '../../knowledge/scripts/knowledgeApi'
import { useDrop } from '../../../frontend/composables/useDrop'
import { useAppSettings } from '../../../frontend/composables/useAppSettings'
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'
import { resolveChatEnterToSend } from '../../../frontend/configs/appSettings'

/**
 * The composer half of a chat body: attachment chips, the drop zone bound to the
 * message list, the Enter-to-send setting, and the guard deciding when a send is
 * allowed at all.
 */
export interface ChatComposerOptions {
  /** The scrollable message list: it doubles as the file drop zone. */
  dropZone: Ref<HTMLElement | null>
  getProjectId: () => string | undefined
  /** Task-scoped chat only — attachments then land in that task's directory. */
  getTaskId?: () => string | undefined
  /** False while the surface refuses input outright (flow done, no CLI session). */
  canSend: () => boolean
  /** True while a turn is already in flight. */
  sending: () => boolean
  /** Hand the composed text off; attachment paths are already appended to it. */
  send: (text: string) => void
}

export function useChatComposer(opts: ChatComposerOptions) {
  const { t } = useI18nHelpers()
  const { settings } = useAppSettings()

  const inputText = ref('')
  const inputRef = ref<HTMLTextAreaElement | null>(null)
  const knowledgeIds = ref<string[]>([])
  const knowledgeError = ref('')

  const attachments = useChatAttachments({
    getProjectId: opts.getProjectId,
    getTaskId: opts.getTaskId,
  })

  // xem docs/architecture/code/nl-chat.md §4
  const canAttach = computed(
    () => opts.canSend() && !opts.sending() && !attachments.uploading.value,
  )
  const canPickKnowledge = computed(() => opts.canSend() && !opts.sending())
  const { isOverDropZone } = useDrop(opts.dropZone, (files) => {
    if (!canAttach.value) return
    attachments.add(files)
  })

  const enterToSend = computed(() => resolveChatEnterToSend(settings.value))
  const composerHint = computed(() =>
    enterToSend.value ? t('nlChat.composer.enterToSend') : t('nlChat.composer.enterToNewline'),
  )

  const canSubmit = computed(
    () =>
      opts.canSend() &&
      !opts.sending() &&
      !attachments.uploading.value &&
      (inputText.value.trim().length > 0 || attachments.items.value.length > 0),
  )

  function onEnterKey(e: KeyboardEvent): void {
    // xem docs/architecture/code/nl-chat.md §4
    if (e.isComposing) return
    if (!enterToSend.value) return
    e.preventDefault()
    void onSend()
  }

  function autoGrow(): void {
    const el = inputRef.value
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  async function onSend(): Promise<void> {
    if (!canSubmit.value) return

    const uploaded = await attachments.upload()
    if (uploaded === null) return

    // xem docs/architecture/code/nl-chat.md §4
    const bundle = knowledgeIds.value.length ? await resolveKnowledge() : []
    const text = appendKnowledge(appendAttachments(inputText.value.trim(), uploaded), bundle)

    inputText.value = ''
    attachments.clear()
    knowledgeIds.value = []
    nextTick(autoGrow)
    opts.send(text)
  }

  async function resolveKnowledge(): Promise<{ id: string; title?: string; path?: string }[]> {
    knowledgeError.value = ''
    if (!knowledgeIds.value.length) return []
    try {
      const data = await fetchKnowledgeBundle(knowledgeIds.value, opts.getProjectId())
      return data.bundle || []
    } catch (e: unknown) {
      knowledgeError.value = t('nlChat.knowledge.resolveFailed', {
        error: String((e as Error)?.message ?? e),
      })
      return []
    }
  }

  return {
    inputText,
    inputRef,
    knowledgeIds,
    knowledgeError,
    /** Cho `KnowledgePickerDialog` biết đọc knowledge của project nào. */
    projectId: computed(() => opts.getProjectId() ?? null),
    attachments,
    canAttach,
    canPickKnowledge,
    canSubmit,
    isOverDropZone,
    enterToSend,
    composerHint,
    onEnterKey,
    onSend,
    autoGrow,
  }
}

/** What a chat body hands to `ChatComposer.vue`. */
export type UseChatComposer = ReturnType<typeof useChatComposer>
