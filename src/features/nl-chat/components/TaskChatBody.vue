<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useTaskChat } from '../composables/useTaskChat'
import { useChatComposer } from '../composables/useChatComposer'
import ChatMessageBubble from './ChatMessageBubble.vue'
import ChatComposer from './ChatComposer.vue'
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'

// Body of the floating chat window when it is scoped to a pipeline step: the
// runner's own conversation history (CLI session transcript) plus an input that
// resumes that exact session. Tool activity turns are what make a running step
// observable while it works.

const props = defineProps<{
  taskId: string
  stepId?: string
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
/** Above this, a user turn gets a "Xem thêm" toggle — step prompts are whole files. */
const COLLAPSE_CHARS = 240

const messagesRef = ref<HTMLElement | null>(null)

/**
 * Display-ordered turns (real + pending, interleaved by send time). Rendering
 * lives in `ChatMessageBubble`; this only decides which turns fold and how they
 * are labelled, so the template keeps no branching of its own — a `computed`
 * re-runs only when `timeline` changes, not on every re-render (e.g. when
 * `running`/`total` change but the turns don't), same pattern as
 * `ArtifactPanel.vue`'s `blocks`.
 */
const displayTurns = computed(() =>
  chat.timeline.value.map((turn) => ({
    ...turn,
    clampable: turn.role === 'user' && turn.text.length > COLLAPSE_CHARS,
    roleLabel: turn.pending ? 'Bạn · đang gửi' : turn.role === 'user' ? 'Bạn' : 'Runner',
    bubbleRole: turn.role === 'assistant' ? ('assistant' as const) : ('user' as const),
  })),
)

/** Why the runner's transcript could not be read, once we know a session exists. */
function transcriptMissingHint(): string {
  return (
    chat.transcriptMissingReason.value ||
    `Không tìm thấy transcript của phiên ${chat.sessionId.value} trên máy này.`
  )
}

/** Reasons an existing-but-empty list stays empty. Only reached with zero turns. */
function noTurnsHint(): string | null {
  if (!chat.sessionId.value) return 'Step này chưa có phiên CLI nào — chạy step trước rồi quay lại đây.'
  if (!chat.transcriptFound.value) return transcriptMissingHint()
  if (chat.pending.value.length === 0) return 'Phiên chưa có nội dung hội thoại nào.'
  return null
}

/**
 * The one line shown in place of a transcript, or null when there is a transcript
 * to show. Resolving the four mutually exclusive reasons here keeps the template
 * down to a single `v-if`.
 */
const emptyHint = computed<string | null>(() => {
  if (chat.loading.value) return 'Đang tải hội thoại của runner…'
  if (chat.turns.value.length > 0) return null
  return noTurnsHint()
})

async function scrollToEnd(): Promise<void> {
  await nextTick()
  const el = messagesRef.value
  if (el) el.scrollTop = el.scrollHeight
}

// Attachments, drop zone, Enter behaviour and the send guard — shared with
// BuilderChatBody, which only differs in what blocks a send and where text goes.
// `ChatComposer` renders it; only the drop-zone flag is needed here, for the
// message list this body owns.
const composer = useChatComposer({
  dropZone: messagesRef,
  getProjectId: () => props.projectId ?? undefined,
  getTaskId: () => props.taskId,
  canSend: () => chat.canSend.value,
  sending: () => chat.sending.value,
  send: (text) => void chat.send(text).then(scrollToEnd),
})
const { isOverDropZone } = composer

const placeholder = computed(() => {
  if (!chat.canSend.value) return chat.blockedText.value || 'Chưa gửi được'
  if (chat.queued.value) return chat.blockedText.value || 'Nhập tin nhắn cho runner…'
  return 'Nhập tin nhắn cho runner…'
})

// Header status: a running step is the interesting state — that is the whole
// point of watching a runner live.
const status = computed<{ kind: 'idle' | 'busy' | 'done' | 'error'; text: string }>(() => {
  // The message itself, not just "Có lỗi": the title's tooltip is the only place
  // the error is described now that the status icon is gone.
  if (chat.error.value) return { kind: 'error', text: `Có lỗi: ${chat.error.value}` }
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
      <p v-if="emptyHint" class="nl-chat-hint">{{ emptyHint }}</p>

      <template v-for="turn in displayTurns" :key="turn.pending ? `pending-${turn.index}` : turn.index">
        <p v-if="turn.role === 'tool'" class="task-chat-activity">
          <span class="task-chat-tool">{{ turn.tool }}</span>
          <span v-if="turn.text" class="task-chat-tool-arg">{{ turn.text }}</span>
        </p>
        <div v-else class="nl-chat-row" :class="`nl-chat-row-${turn.role}`">
          <span class="nl-chat-role">{{ turn.roleLabel }}</span>
          <ChatMessageBubble
            :role="turn.bubbleRole"
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

    <ChatComposer :composer="composer" :placeholder="placeholder" />
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
