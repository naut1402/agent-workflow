<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useTaskChat } from '../composables/useTaskChat'
import { parseMarkdown } from '../../../core/lib/markdownLib'

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

const inputText = ref('')
const expanded = ref<Set<number>>(new Set())
/** Long turns (step prompts are whole files) are collapsed until asked for. */
const COLLAPSE_CHARS = 240

const messagesRef = ref<HTMLElement | null>(null)

/** Only user turns collapse: a step's prompt is a whole file, and slicing
 *  markdown mid-syntax would render broken. */
function canCollapse(turn: { role: string; text: string }): boolean {
  return turn.role === 'user' && turn.text.length > COLLAPSE_CHARS
}

function isCollapsed(turn: { index: number; role: string; text: string }): boolean {
  return canCollapse(turn) && !expanded.value.has(turn.index)
}

function toggle(index: number): void {
  const next = new Set(expanded.value)
  if (next.has(index)) next.delete(index)
  else next.add(index)
  expanded.value = next
}

function shown(turn: { index: number; role: string; text: string }): string {
  return isCollapsed(turn) ? `${turn.text.slice(0, COLLAPSE_CHARS)}…` : turn.text
}

/**
 * Display-ordered turns (real + pending, interleaved by send time) with assistant
 * markdown pre-rendered — a `computed` re-runs only when `timeline` changes, not on
 * every re-render (e.g. when `running`/`total` change but the turns themselves don't),
 * same pattern as `ArtifactPanel.vue`'s `blocks`.
 */
const displayTurns = computed(() =>
  chat.timeline.value.map((turn) => ({
    ...turn,
    html: turn.role === 'assistant' ? parseMarkdown(turn.text) : undefined,
  })),
)

async function scrollToEnd(): Promise<void> {
  await nextTick()
  const el = messagesRef.value
  if (el) el.scrollTop = el.scrollHeight
}

function onSend(): void {
  const text = inputText.value
  if (!text.trim()) return
  inputText.value = ''
  nextTick(autoGrow)
  void chat.send(text).then(scrollToEnd)
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
    <div ref="messagesRef" class="nl-chat-messages">
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
          <!-- eslint-disable-next-line vue/no-v-html -- agent markdown, same trust level as artifacts -->
          <div
            v-if="turn.role === 'assistant'"
            class="nl-chat-message nl-chat-message-assistant md"
            v-html="turn.html"
          ></div>
          <p
            v-else
            class="nl-chat-message"
            :class="[`nl-chat-message-${turn.role}`, { 'is-pending': turn.pending }]"
          >
            {{ shown(turn) }}
          </p>
          <button v-if="canCollapse(turn)" type="button" class="task-chat-more" @click="toggle(turn.index)">
            {{ isCollapsed(turn) ? 'Xem thêm' : 'Thu lại' }}
          </button>
        </div>
      </template>

      <p v-if="chat.error.value" class="nl-chat-error">{{ chat.error.value }}</p>
      <p v-if="chat.staleReason.value" class="nl-chat-nudge">
        Phiên đã cũ ({{ chat.staleReason.value }}) — tin nhắn mới có thể mở phiên khác, agent sẽ không nhớ ngữ cảnh trước.
      </p>
    </div>

    <form class="nl-chat-input-row" @submit.prevent="onSend">
      <textarea
        ref="inputRef"
        v-model="inputText"
        rows="1"
        :placeholder="placeholder"
        title="Enter để gửi, Shift+Enter để xuống dòng"
        :disabled="!chat.canSend.value || chat.sending.value"
        @input="autoGrow"
        @keydown.enter.exact.prevent="onSend"
      ></textarea>
      <button type="submit" :disabled="!chat.canSend.value || chat.sending.value || !inputText.trim()">
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
.task-chat-more {
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
  font-size: 11px;
  padding: 0;
}
.is-pending {
  opacity: 0.6;
}
</style>
