import { computed, nextTick, ref, type Ref } from 'vue'
import { useChatAttachments } from './useChatAttachments'
import { appendAttachments } from '../lib/attachmentPrompt'
import { appendKnowledge } from '../lib/knowledgePrompt'
import { fetchKnowledgeBundle } from '../../knowledge/scripts/knowledgeApi'
import { useDrop } from '../../../core/composables/useDrop'
import { useAppSettings } from '../../../core/composables/useAppSettings'
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { resolveChatEnterToSend } from '../../../core/configs/appSettings'

/**
 * The composer half of a chat body: attachment chips, the drop zone bound to the
 * message list, the Enter-to-send setting, and the guard deciding when a send is
 * allowed at all.
 *
 * `BuilderChatBody` and `TaskChatBody` grew this verbatim in both files. They
 * differ in only two things — what "can send" means for that surface, and where
 * the composed text goes — so those are the callbacks; everything else lives
 * here once.
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
  /** Id knowledge đã chọn — con trỏ, resolve thành đường dẫn lúc gửi. */
  const knowledgeIds = ref<string[]>([])
  const knowledgeError = ref('')

  const attachments = useChatAttachments({
    getProjectId: opts.getProjectId,
    getTaskId: opts.getTaskId,
  })

  /**
   * Also false while an upload is in flight: `attachments.upload()` snapshots
   * the list it is uploading, so a file staged mid-upload never reaches the
   * server yet gets cleared with the rest once the send completes — it vanishes
   * with no error anywhere.
   */
  const canAttach = computed(
    () => opts.canSend() && !opts.sending() && !attachments.uploading.value,
  )
  const { isOverDropZone } = useDrop(opts.dropZone, (files) => {
    if (!canAttach.value) return
    attachments.add(files)
  })

  const enterToSend = computed(() => resolveChatEnterToSend(settings.value))
  const composerHint = computed(() =>
    enterToSend.value ? t('nlChat.composer.enterToSend') : t('nlChat.composer.enterToNewline'),
  )

  /**
   * The single answer to "is the Gửi button live?" — the two bodies each spelled
   * this out again inside a four-term `:disabled` expression. An empty box with
   * no chips is not a message, so it does not count as sendable.
   */
  const canSubmit = computed(
    () =>
      opts.canSend() &&
      !opts.sending() &&
      !attachments.uploading.value &&
      (inputText.value.trim().length > 0 || attachments.items.value.length > 0),
  )

  function onEnterKey(e: KeyboardEvent): void {
    // Vietnamese IME: Enter commits the word being typed — never a send.
    if (e.isComposing) return
    if (!enterToSend.value) return // no preventDefault → the textarea inserts a newline
    e.preventDefault()
    void onSend()
  }

  /** Grow with the text up to the CSS max-height, then scroll. */
  function autoGrow(): void {
    const el = inputRef.value
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  async function onSend(): Promise<void> {
    if (!canSubmit.value) return

    const uploaded = await attachments.upload()
    if (uploaded === null) return // upload failed — keep text + chips so it can be retried

    // Resolve id → path at send time, not at pick time: knowledge edited between
    // two turns then reaches the next turn in its new state, which is the whole
    // point of `knowledge_inputs` being a pointer.
    // Không chọn knowledge thì không thêm await nào — đường gửi thường giữ
    // nguyên số microtask, thứ mà cả UI lẫn test đang dựa vào.
    const bundle = knowledgeIds.value.length ? await resolveKnowledge() : []
    const text = appendKnowledge(appendAttachments(inputText.value.trim(), uploaded), bundle)

    inputText.value = ''
    attachments.clear()
    knowledgeIds.value = []
    nextTick(autoGrow)
    opts.send(text)
  }

  /**
   * A failed bundle must not eat the turn: the message still goes out, just
   * without the knowledge block, and the warning stays on screen. Losing what
   * the user typed is worse than sending it without the paths.
   */
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
