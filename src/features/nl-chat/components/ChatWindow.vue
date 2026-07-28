<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useNlChatSession, type NlChatEntityType } from '../composables/useNlChatSession'

const props = defineProps<{ projectId?: string | null }>()
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
  selectEntity,
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

function onSelectEntity(type: NlChatEntityType): void {
  selectEntity(type)
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
</script>

<template>
  <div class="nl-chat-window" role="dialog" aria-label="Tạo mới bằng ngôn ngữ tự nhiên">
    <header class="nl-chat-header">
      <span class="nl-chat-title">Tạo mới bằng chat</span>
      <button type="button" class="nl-chat-close" title="Đóng" @click="onClose">×</button>
    </header>

    <div class="nl-chat-body">
      <div v-if="step === 'selectEntity'" class="nl-chat-select-entity">
        <p>Bạn muốn tạo gì?</p>
        <div class="nl-chat-entity-buttons">
          <button type="button" @click="onSelectEntity('task')">Task</button>
          <button type="button" @click="onSelectEntity('pipeline')">Pipeline</button>
          <button type="button" @click="onSelectEntity('agent')">Agent</button>
        </div>
      </div>

      <template v-else-if="step === 'chatting' || step === 'confirming' || step === 'done' || step === 'error'">
        <div class="nl-chat-messages">
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
            placeholder="Nhập mô tả..."
            :disabled="sending || step === 'done'"
          />
          <button type="submit" :disabled="sending || !inputText.trim() || step === 'done'">Gửi</button>
        </form>
      </template>

      <div v-else-if="step === 'previewDraft'" class="nl-chat-preview">
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
.nl-chat-window {
  position: fixed;
  right: 24px;
  bottom: 88px;
  width: 340px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  background: var(--color-surface, #fff);
  color: var(--color-text, #111);
  border: 1px solid var(--color-border, #ddd);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  z-index: 1000;
}
.nl-chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border, #ddd);
}
.nl-chat-title {
  font-weight: 600;
}
.nl-chat-close {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
}
.nl-chat-body {
  padding: 10px 12px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.nl-chat-entity-buttons {
  display: flex;
  gap: 8px;
}
.nl-chat-messages {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 40vh;
  overflow-y: auto;
}
.nl-chat-message-user {
  align-self: flex-end;
  background: var(--color-accent-soft, #e6f0ff);
  border-radius: 8px;
  padding: 6px 10px;
}
.nl-chat-message-assistant {
  align-self: flex-start;
  background: var(--color-surface-muted, #f3f3f3);
  border-radius: 8px;
  padding: 6px 10px;
}
.nl-chat-input-row {
  display: flex;
  gap: 6px;
}
.nl-chat-input-row input {
  flex: 1;
}
.nl-chat-draft-textarea {
  width: 100%;
  font-family: monospace;
  font-size: 12px;
}
.nl-chat-preview-actions {
  display: flex;
  gap: 8px;
}
.nl-chat-error {
  color: var(--color-danger, #c0392b);
}
.nl-chat-nudge {
  font-style: italic;
  opacity: 0.8;
}
.nl-chat-done {
  color: var(--color-success, #2a9d5c);
  font-weight: 600;
}
</style>
