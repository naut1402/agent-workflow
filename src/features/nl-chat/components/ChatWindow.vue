<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useNlChatSession, type NlChatEntityType } from '../composables/useNlChatSession'

const props = defineProps<{
  projectId?: string | null
  /** Live position of the floating icon — the window docks above it and follows while dragging. */
  anchor?: { right: number; bottom: number }
}>()
const emit = defineEmits<{ close: [] }>()

const {
  step,
  entityType,
  messages,
  draft,
  pipelineName,
  sending,
  confirming,
  error,
  showLongChatNudge,
  catalogAgentIds,
  catalogError,
  sendMessage,
  confirm,
  cancel,
  findInvalidPipelineAgentRefs,
} = useNlChatSession({ getProjectId: () => props.projectId ?? undefined })

const draftText = ref('')
const draftParseError = ref<string | null>(null)

watch(draft, (d) => {
  draftText.value = d ? JSON.stringify(d, null, 2) : ''
  draftParseError.value = null
})

const inputText = ref('')

function onSend(): void {
  const text = inputText.value.trim()
  if (!text) return
  inputText.value = ''
  void sendMessage(text)
}

// design.md §4.4: pipeline draft's steps[].agent must be validated against
// fetchCatalog() before "Xác nhận" is allowed — see useNlChatSession.ts.
// Re-parses the (possibly user-edited) draftText live so the button reacts
// as soon as the user fixes/breaks a ref, not just at the moment the agent
// first returned the draft.
const pipelineAgentError = computed<string | null>(() => {
  if (entityType.value !== 'pipeline' || step.value !== 'previewDraft') return null
  if (catalogError.value) return catalogError.value
  if (!catalogAgentIds.value) return 'Đang kiểm tra danh sách agent hợp lệ...'
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(draftText.value)
  } catch {
    // Invalid JSON is already surfaced via draftParseError on confirm attempt.
    return null
  }
  const invalid = findInvalidPipelineAgentRefs(parsed)
  return invalid.length > 0 ? `Agent không tồn tại trong catalog: ${invalid.join(', ')}` : null
})

const canConfirm = computed(
  () =>
    step.value === 'previewDraft' &&
    (entityType.value !== 'pipeline' || pipelineName.value.trim().length > 0) &&
    (entityType.value !== 'pipeline' || !pipelineAgentError.value),
)

function onConfirm(): void {
  try {
    const parsed = JSON.parse(draftText.value)
    draftParseError.value = null
    void confirm(parsed)
  } catch {
    draftParseError.value = 'Draft JSON không hợp lệ — vui lòng sửa lại trước khi xác nhận.'
  }
}

function onCancel(): void {
  void cancel()
  emit('close')
}

function onClose(): void {
  emit('close')
}

const WINDOW_WIDTH = 340
/** Vertical space taken by the icon itself plus a small gap. */
const ANCHOR_OFFSET = 48
const VIEWPORT_MARGIN = 8

const windowRef = ref<HTMLElement | null>(null)
/** Height assumed before the element is mounted (max-height: 70vh). */
const FALLBACK_HEIGHT_RATIO = 0.7

// The window is anchored to the (draggable) icon rather than pinned to the
// viewport corner, so moving the icon moves the chat with it. Clamped so it
// never leaves the viewport when the icon is dragged to an edge.
const anchorStyle = computed(() => {
  const anchor = props.anchor ?? { right: 24, bottom: 24 }
  const height = windowRef.value?.offsetHeight || window.innerHeight * FALLBACK_HEIGHT_RATIO
  const maxRight = Math.max(VIEWPORT_MARGIN, window.innerWidth - WINDOW_WIDTH - VIEWPORT_MARGIN)
  const maxBottom = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN)
  return {
    right: `${Math.min(Math.max(anchor.right, VIEWPORT_MARGIN), maxRight)}px`,
    bottom: `${Math.min(anchor.bottom + ANCHOR_OFFSET, maxBottom)}px`,
  }
})

const ENTITY_LABELS: Record<NlChatEntityType, string> = {
  task: 'Task',
  pipeline: 'Pipeline',
  agent: 'Agent',
}

const minimized = ref(false)

// A turn is a CLI round trip that can take tens of seconds, so "đang suy nghĩ"
// alone reads as frozen — the elapsed counter is the progress signal.
const waitingSeconds = ref(0)
let waitTimer: ReturnType<typeof setInterval> | null = null

watch(
  () => sending.value || confirming.value,
  (busy) => {
    if (waitTimer) {
      clearInterval(waitTimer)
      waitTimer = null
    }
    waitingSeconds.value = 0
    if (busy) waitTimer = setInterval(() => (waitingSeconds.value += 1), 1000)
  },
)

onUnmounted(() => {
  if (waitTimer) clearInterval(waitTimer)
})

type ChatStatus = 'idle' | 'busy' | 'done' | 'error'

const status = computed<ChatStatus>(() => {
  if (sending.value || confirming.value) return 'busy'
  if (step.value === 'error' || error.value) return 'error'
  if (step.value === 'done') return 'done'
  return 'idle'
})

const statusText = computed(() => {
  switch (status.value) {
    case 'busy':
      return confirming.value
        ? `Đang tạo… ${waitingSeconds.value}s`
        : `Agent đang suy nghĩ… ${waitingSeconds.value}s`
    case 'error':
      return 'Có lỗi'
    case 'done':
      return 'Hoàn tất'
    default:
      return 'Sẵn sàng'
  }
})

// Keep the newest message in view as the conversation grows.
const messagesRef = ref<HTMLElement | null>(null)
watch(
  [() => messages.value.length, () => sending.value, minimized],
  async () => {
    await nextTick()
    const el = messagesRef.value
    if (el) el.scrollTop = el.scrollHeight
  },
)
</script>

<template>
  <div
    ref="windowRef"
    class="nl-chat-window"
    :class="{ 'is-minimized': minimized }"
    role="dialog"
    aria-label="Trò chuyện tạo mới"
    :style="anchorStyle"
  >
    <header class="nl-chat-header">
      <span class="nl-chat-title">Trợ lý tạo mới</span>
      <span class="nl-chat-status" :class="`is-${status}`">
        <span class="nl-chat-status-dot" aria-hidden="true"></span>
        <span class="nl-chat-status-text">{{ statusText }}</span>
      </span>
      <button
        type="button"
        class="nl-chat-icon-btn"
        :title="minimized ? 'Mở rộng' : 'Thu nhỏ'"
        :aria-expanded="!minimized"
        @click="minimized = !minimized"
      >
        {{ minimized ? '▢' : '—' }}
      </button>
      <button type="button" class="nl-chat-icon-btn" title="Đóng" @click="onClose">×</button>
    </header>

    <div v-show="!minimized" class="nl-chat-body">
      <template v-if="step === 'chatting' || step === 'confirming' || step === 'done' || step === 'error'">
        <div ref="messagesRef" class="nl-chat-messages">
          <p v-if="messages.length === 0" class="nl-chat-hint">
            Mô tả điều bạn muốn — mình sẽ hỏi thêm nếu thiếu, rồi dựng draft Task, Pipeline hoặc Agent cho bạn.
          </p>
          <div v-for="(m, i) in messages" :key="i" class="nl-chat-row" :class="`nl-chat-row-${m.role}`">
            <span class="nl-chat-role">{{ m.role === 'user' ? 'Bạn' : 'Trợ lý' }}</span>
            <p class="nl-chat-message" :class="`nl-chat-message-${m.role}`">{{ m.text }}</p>
          </div>
          <div v-if="sending" class="nl-chat-row nl-chat-row-assistant">
            <span class="nl-chat-role">Trợ lý</span>
            <p class="nl-chat-message nl-chat-message-assistant nl-chat-typing" aria-live="polite">
              <span class="nl-chat-dot"></span>
              <span class="nl-chat-dot"></span>
              <span class="nl-chat-dot"></span>
              <span class="nl-chat-typing-label">{{ waitingSeconds }}s</span>
            </p>
          </div>
          <p v-if="showLongChatNudge" class="nl-chat-nudge">
            Có thể mô tả gọn lại giúp mình không?
          </p>
          <p v-if="error" class="nl-chat-error">{{ error }}</p>
          <p v-if="step === 'done'" class="nl-chat-done">Đã tạo thành công.</p>
        </div>
        <form class="nl-chat-input-row" @submit.prevent="onSend">
          <input
            v-model="inputText"
            type="text"
            placeholder="Nhập tin nhắn..."
            :disabled="sending || step === 'done'"
          />
          <button type="submit" :disabled="sending || !inputText.trim() || step === 'done'">Gửi</button>
        </form>
      </template>

      <div v-else-if="step === 'previewDraft'" class="nl-chat-preview">
        <p v-if="entityType" class="nl-chat-entity-badge">Draft {{ ENTITY_LABELS[entityType] }}</p>
        <label v-if="entityType === 'pipeline'" class="nl-chat-pipeline-name">
          Tên pipeline
          <input v-model="pipelineName" type="text" placeholder="Tên profile pipeline" />
        </label>
        <textarea v-model="draftText" class="nl-chat-draft-textarea" rows="14"></textarea>
        <p v-if="draftParseError" class="nl-chat-error">{{ draftParseError }}</p>
        <p v-if="entityType === 'pipeline' && pipelineAgentError" class="nl-chat-error">{{ pipelineAgentError }}</p>
        <div class="nl-chat-preview-actions">
          <button type="button" :disabled="!canConfirm || confirming" @click="onConfirm">Xác nhận & tạo</button>
          <button type="button" @click="onCancel">Huỷ</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Theme tokens only (see src/styles/_tokens.scss) — the panel must follow the
   light/dark theme instead of the previous hardcoded white surface. */
.nl-chat-window {
  position: fixed;
  width: 340px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  background: var(--panel);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  z-index: 1000;
}
.nl-chat-window.is-minimized {
  max-height: none;
}
.nl-chat-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}
.nl-chat-window.is-minimized .nl-chat-header {
  border-bottom: none;
}
.nl-chat-title {
  font-weight: 600;
}
.nl-chat-status {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-right: auto;
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
}
.nl-chat-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--muted);
}
.nl-chat-status.is-busy .nl-chat-status-dot {
  background: var(--accent);
  animation: nl-chat-pulse 1.2s ease-in-out infinite;
}
.nl-chat-status.is-done .nl-chat-status-dot {
  background: var(--ok);
}
.nl-chat-status.is-error .nl-chat-status-dot {
  background: var(--danger);
}
@keyframes nl-chat-pulse {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 1;
  }
}
.nl-chat-icon-btn {
  background: none;
  border: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
  padding: 2px 4px;
}
.nl-chat-icon-btn:hover {
  color: var(--text);
}
.nl-chat-body {
  padding: 10px 12px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.nl-chat-messages {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 40vh;
  overflow-y: auto;
}
.nl-chat-hint {
  color: var(--muted);
  font-size: 12px;
}
/* User right, assistant left — the offset (plus max-width and the role label)
   is what makes the two sides readable at a glance. */
.nl-chat-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: 85%;
}
.nl-chat-row-user {
  align-self: flex-end;
  align-items: flex-end;
  text-align: right;
}
.nl-chat-row-assistant {
  align-self: flex-start;
  align-items: flex-start;
}
.nl-chat-role {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}
.nl-chat-message {
  padding: 6px 10px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.nl-chat-message-user {
  background: var(--accent-dim);
  border-radius: 10px 10px 2px 10px;
}
.nl-chat-message-assistant {
  background: var(--panel-2);
  border-radius: 10px 10px 10px 2px;
}
.nl-chat-typing {
  display: flex;
  align-items: center;
  gap: 4px;
}
.nl-chat-typing-label {
  margin-left: 4px;
  font-size: 10px;
  color: var(--muted);
}
.nl-chat-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--muted);
  animation: nl-chat-bounce 1.1s ease-in-out infinite;
}
.nl-chat-dot:nth-child(2) {
  animation-delay: 0.15s;
}
.nl-chat-dot:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes nl-chat-bounce {
  0%,
  80%,
  100% {
    opacity: 0.3;
    transform: translateY(0);
  }
  40% {
    opacity: 1;
    transform: translateY(-2px);
  }
}
.nl-chat-input-row {
  display: flex;
  gap: 6px;
}
.nl-chat-input-row input,
.nl-chat-pipeline-name input,
.nl-chat-draft-textarea {
  background: var(--input-surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 5px 8px;
}
.nl-chat-input-row input {
  flex: 1;
  min-width: 0;
}
.nl-chat-input-row button,
.nl-chat-preview-actions button {
  background: var(--panel-2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 5px 10px;
  cursor: pointer;
}
.nl-chat-input-row button:hover:not(:disabled),
.nl-chat-preview-actions button:hover:not(:disabled) {
  background: var(--hover-surface);
  border-color: var(--accent);
}
.nl-chat-input-row button:disabled,
.nl-chat-preview-actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.nl-chat-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.nl-chat-entity-badge {
  align-self: flex-start;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--accent);
  background: var(--accent-dim);
  border-radius: 999px;
  padding: 2px 8px;
}
.nl-chat-pipeline-name {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}
.nl-chat-draft-textarea {
  width: 100%;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  resize: vertical;
}
.nl-chat-preview-actions {
  display: flex;
  gap: 8px;
}
.nl-chat-error {
  color: var(--danger);
}
.nl-chat-nudge {
  font-style: italic;
  color: var(--muted);
}
.nl-chat-done {
  color: var(--ok);
  font-weight: 600;
}
</style>
