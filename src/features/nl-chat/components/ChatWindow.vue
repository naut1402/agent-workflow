<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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
</script>

<template>
  <div ref="windowRef" class="nl-chat-window" role="dialog" aria-label="Trò chuyện tạo mới" :style="anchorStyle">
    <header class="nl-chat-header">
      <span class="nl-chat-title">Trợ lý tạo mới</span>
      <button type="button" class="nl-chat-close" title="Đóng" @click="onClose">×</button>
    </header>

    <div class="nl-chat-body">
      <template v-if="step === 'chatting' || step === 'confirming' || step === 'done' || step === 'error'">
        <div class="nl-chat-messages">
          <p v-if="messages.length === 0" class="nl-chat-hint">
            Mô tả điều bạn muốn — mình sẽ hỏi thêm nếu thiếu, rồi dựng draft Task, Pipeline hoặc Agent cho bạn.
          </p>
          <p v-for="(m, i) in messages" :key="i" class="nl-chat-message" :class="`nl-chat-message-${m.role}`">
            {{ m.text }}
          </p>
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
.nl-chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}
.nl-chat-title {
  font-weight: 600;
}
.nl-chat-close {
  background: none;
  border: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
}
.nl-chat-close:hover {
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
.nl-chat-message-user {
  align-self: flex-end;
  background: var(--accent-dim);
  border-radius: 8px;
  padding: 6px 10px;
}
.nl-chat-message-assistant {
  align-self: flex-start;
  background: var(--panel-2);
  border-radius: 8px;
  padding: 6px 10px;
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
