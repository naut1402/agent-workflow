<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useTaskChat } from '../composables/useTaskChat'
import { parseMarkdown } from '../../../shared/markdown'

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

/** Runner replies are markdown (lists, code fences, headings) — render them. */
function renderMarkdown(text: string): string {
  return parseMarkdown(text)
}

async function scrollToEnd(): Promise<void> {
  await nextTick()
  const el = messagesRef.value
  if (el) el.scrollTop = el.scrollHeight
}

function onSend(): void {
  const text = inputText.value
  if (!text.trim()) return
  inputText.value = ''
  void chat.send(text).then(scrollToEnd)
}

const placeholder = computed(() =>
  chat.canSend.value ? 'Nhập tin nhắn cho runner…' : chat.blockedText.value || 'Chưa gửi được',
)

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
      <p v-else-if="!chat.sessionId.value" class="nl-chat-hint">
        Step này chưa có phiên CLI nào — chạy step trước rồi quay lại đây.
      </p>
      <p v-else-if="!chat.transcriptFound.value" class="nl-chat-hint">
        Không tìm thấy transcript của phiên {{ chat.sessionId.value }} trên máy này.
      </p>
      <p v-else-if="chat.turns.value.length === 0 && chat.pending.value.length === 0" class="nl-chat-hint">
        Phiên chưa có nội dung hội thoại nào.
      </p>

      <template v-for="turn in chat.turns.value" :key="turn.index">
        <p v-if="turn.role === 'tool'" class="task-chat-activity">
          <span class="task-chat-tool">{{ turn.tool }}</span>
          <span v-if="turn.text" class="task-chat-tool-arg">{{ turn.text }}</span>
        </p>
        <div v-else class="nl-chat-row" :class="`nl-chat-row-${turn.role}`">
          <span class="nl-chat-role">{{ turn.role === 'user' ? 'Bạn' : 'Runner' }}</span>
          <!-- eslint-disable-next-line vue/no-v-html -- agent markdown, same trust level as artifacts -->
          <div
            v-if="turn.role === 'assistant'"
            class="nl-chat-message nl-chat-message-assistant md"
            v-html="renderMarkdown(turn.text)"
          ></div>
          <p v-else class="nl-chat-message" :class="`nl-chat-message-${turn.role}`">{{ shown(turn) }}</p>
          <button v-if="canCollapse(turn)" type="button" class="task-chat-more" @click="toggle(turn.index)">
            {{ isCollapsed(turn) ? 'Xem thêm' : 'Thu lại' }}
          </button>
        </div>
      </template>

      <div v-for="(text, i) in chat.pending.value" :key="`pending-${i}`" class="nl-chat-row nl-chat-row-user">
        <span class="nl-chat-role">Bạn · đang gửi</span>
        <p class="nl-chat-message nl-chat-message-user is-pending">{{ text }}</p>
      </div>

      <p v-if="chat.error.value" class="nl-chat-error">{{ chat.error.value }}</p>
      <p v-if="chat.staleReason.value" class="nl-chat-nudge">
        Phiên đã cũ ({{ chat.staleReason.value }}) — tin nhắn mới có thể mở phiên khác, agent sẽ không nhớ ngữ cảnh trước.
      </p>
    </div>

    <form class="nl-chat-input-row" @submit.prevent="onSend">
      <input
        v-model="inputText"
        type="text"
        :placeholder="placeholder"
        :disabled="!chat.canSend.value || chat.sending.value"
      />
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
