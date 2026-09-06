<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useTaskChat } from '../composables/useTaskChat'
import { useChatAttachments } from '../composables/useChatAttachments'
import { appendAttachments } from '../lib/attachmentPrompt'
import ChatMessageBubble from './ChatMessageBubble.vue'
import ChatAttachmentBar from './ChatAttachmentBar.vue'
import { useDrop } from '../../../core/composables/useDrop'
import { useAppSettings } from '../../../core/composables/useAppSettings'
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { resolveChatEnterToSend } from '../../../core/configs/appSettings'

// Body of the floating chat window when it is scoped to a pipeline step: the
// runner's own conversation history (CLI session transcript) plus an input that
// resumes that exact session. Tool activity turns are what make a running step
// observable while it works.

const props = defineProps<{
  taskId: string
  stepId?: string
  stepLabel?: string
  projectId?: string | null
  /** False while the window is minimized — polling pauses instead of running unseen. */
  active?: boolean
}>()
const emit = defineEmits<{
  status: [{ kind: 'idle' | 'busy' | 'done' | 'error'; text: string }]
  /** Runner behind this step's session — shown in the header's info popover. */
  runner: [{ id: string; name: string; enabled: boolean } | null]
}>()

const chat = useTaskChat({
  getTaskId: () => props.taskId,
  getStepId: () => props.stepId,
  getProjectId: () => props.projectId ?? undefined,
})

const { t } = useI18nHelpers()
const inputText = ref('')
/** Above this, a user turn gets a "Xem thêm" toggle — step prompts are whole files. */
const COLLAPSE_CHARS = 240

const messagesRef = ref<HTMLElement | null>(null)

/**
 * Display-ordered turns (real + pending, interleaved by send time). Rendering
 * lives in `ChatMessageBubble`; this only flags which turns are long enough to
 * fold — a `computed` re-runs only when `timeline` changes, not on every
 * re-render (e.g. when `running`/`total` change but the turns don't), same
 * pattern as `ArtifactPanel.vue`'s `blocks`.
 */
const displayTurns = computed(() =>
  chat.timeline.value.map((turn) => ({
    ...turn,
    clampable: turn.role === 'user' && turn.text.length > COLLAPSE_CHARS,
  })),
)

// ── attachments ───────────────────────────────────────────────────────────
const attachments = useChatAttachments({
  getProjectId: () => props.projectId ?? undefined,
  getTaskId: () => props.taskId,
})
const canAttach = computed(() => chat.canSend.value && !chat.sending.value)
const { isOverDropZone } = useDrop(messagesRef, (files) => {
  if (!canAttach.value) return
  attachments.add(files)
})

// ── Enter behaviour ───────────────────────────────────────────────────────
const { settings } = useAppSettings()
const enterToSend = computed(() => resolveChatEnterToSend(settings.value))
const composerHint = computed(() =>
  enterToSend.value ? t('nlChat.composer.enterToSend') : t('nlChat.composer.enterToNewline'),
)

function onEnterKey(e: KeyboardEvent): void {
  // Vietnamese IME: Enter commits the word being typed — never a send.
  if (e.isComposing) return
  if (!enterToSend.value) return // no preventDefault → the textarea inserts a newline
  e.preventDefault()
  void onSend()
}

async function scrollToEnd(): Promise<void> {
  await nextTick()
  const el = messagesRef.value
  if (el) el.scrollTop = el.scrollHeight
}

async function onSend(): Promise<void> {
  if (!chat.canSend.value || chat.sending.value || attachments.uploading.value) return
  const text = inputText.value.trim()
  if (!text && attachments.items.value.length === 0) return

  const uploaded = await attachments.upload()
  if (uploaded === null) return // upload failed — keep text + chips so it can be retried
  const finalText = appendAttachments(text, uploaded)

  inputText.value = ''
  attachments.clear()
  nextTick(autoGrow)
  void chat.send(finalText).then(scrollToEnd)
}

const inputRef = ref<HTMLTextAreaElement | null>(null)
/** Grow with the text up to the CSS max-height, then scroll. */
function autoGrow(): void {
  const el = inputRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

const placeholder = computed(() => {
  if (!chat.canSend.value) return chat.blockedText.value || 'Chưa gửi được'
  if (chat.queued.value) return chat.blockedText.value || 'Nhập tin nhắn cho runner…'
  return 'Nhập tin nhắn cho runner…'
})

// Header status: a running step is the interesting state — that is the whole
// point of watching a runner live.
const status = computed<{ kind: 'idle' | 'busy' | 'done' | 'error'; text: string }>(() => {
  if (chat.error.value) return { kind: 'error', text: 'Có lỗi' }
  if (chat.sending.value) return { kind: 'busy', text: 'Đang gửi…' }
  if (chat.running.value) {
    const step = chat.running.value.stepId
    return { kind: 'busy', text: step ? `Runner đang chạy: ${step}` : 'Runner đang chạy' }
  }
  return { kind: 'idle', text: chat.canSend.value ? 'Sẵn sàng' : 'Chưa gửi được' }
})

watch(status, (s) => emit('status', s), { immediate: true })
watch(chat.runner, (r) => emit('runner', r), { immediate: true })

watch([() => chat.turns.value.length, () => chat.pending.value.length], scrollToEnd)

// Re-scope (and restart polling) when the user opens the chat from another step.
watch(
  () => `${props.taskId}::${props.stepId ?? ''}`,
  () => {
    chat.stop()
    void chat.start().then(scrollToEnd)
  },
)

// Minimized: the component stays mounted (so the conversation is still there on
// reopen) but must not keep polling in the background.
watch(
  () => props.active !== false,
  (visible) => {
    if (visible) void chat.start().then(scrollToEnd)
    else chat.stop()
  },
)

onMounted(() => {
  if (props.active !== false) void chat.start().then(scrollToEnd)
})
onUnmounted(() => chat.stop())
</script>

<template>
  <div class="task-chat">
    <div ref="messagesRef" class="nl-chat-messages" :class="{ 'is-drop-over': isOverDropZone }">
      <p v-if="isOverDropZone" class="nl-chat-drop-hint">{{ t('nlChat.attachment.dropHint') }}</p>
      <p v-if="chat.loading.value" class="nl-chat-hint">Đang tải hội thoại của runner…</p>
      <p v-else-if="!chat.sessionId.value && chat.turns.value.length === 0" class="nl-chat-hint">
        Step này chưa có phiên CLI nào — chạy step trước rồi quay lại đây.
      </p>
      <p v-else-if="chat.sessionId.value && !chat.transcriptFound.value && chat.turns.value.length === 0" class="nl-chat-hint">
        {{
          chat.transcriptMissingReason.value ||
          `Không tìm thấy transcript của phiên ${chat.sessionId.value} trên máy này.`
        }}
      </p>
      <p v-else-if="chat.turns.value.length === 0 && chat.pending.value.length === 0" class="nl-chat-hint">
        Phiên chưa có nội dung hội thoại nào.
      </p>

      <template v-for="turn in displayTurns" :key="turn.pending ? `pending-${turn.index}` : turn.index">
        <p v-if="turn.role === 'tool'" class="task-chat-activity">
          <span class="task-chat-tool">{{ turn.tool }}</span>
          <span v-if="turn.text" class="task-chat-tool-arg">{{ turn.text }}</span>
        </p>
        <div v-else class="nl-chat-row" :class="`nl-chat-row-${turn.role}`">
          <span class="nl-chat-role">{{ turn.pending ? 'Bạn · đang gửi' : turn.role === 'user' ? 'Bạn' : 'Runner' }}</span>
          <ChatMessageBubble
            :role="turn.role === 'assistant' ? 'assistant' : 'user'"
            :text="turn.text"
            :pending="turn.pending"
            :clampable="turn.clampable"
          />
        </div>
      </template>

      <p v-if="chat.error.value" class="nl-chat-error">{{ chat.error.value }}</p>
      <p v-if="chat.staleReason.value" class="nl-chat-nudge">
        Phiên đã cũ ({{ chat.staleReason.value }}) — tin nhắn mới có thể mở phiên khác, agent sẽ không nhớ ngữ cảnh trước.
      </p>
    </div>

    <ChatAttachmentBar
      :items="attachments.items.value"
      :error="attachments.error.value"
      :disabled="!canAttach"
      @pick="attachments.add"
      @remove="attachments.remove"
    />

    <form class="nl-chat-input-row" @submit.prevent="onSend">
      <textarea
        ref="inputRef"
        v-model="inputText"
        rows="1"
        :placeholder="placeholder"
        :title="composerHint"
        :disabled="!chat.canSend.value || chat.sending.value"
        @input="autoGrow"
        @keydown.enter.exact="onEnterKey"
        @keydown.ctrl.enter.prevent="onSend"
        @keydown.meta.enter.prevent="onSend"
      ></textarea>
      <button
        type="submit"
        :disabled="
          !chat.canSend.value ||
          chat.sending.value ||
          attachments.uploading.value ||
          (!inputText.trim() && attachments.items.value.length === 0)
        "
      >
        Gửi
      </button>
    </form>
  </div>
</template>

<style scoped>
.task-chat {
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* Fills the (resizable) window body; the message list scrolls inside. */
  flex: 1 1 auto;
  min-height: 0;
}
.task-chat-activity {
  align-self: stretch;
  display: flex;
  gap: 6px;
  font-size: 11px;
  color: var(--muted);
  border-left: 2px solid var(--border);
  padding-left: 6px;
}
.task-chat-tool {
  color: var(--accent);
  font-weight: 600;
}
.task-chat-tool-arg {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
