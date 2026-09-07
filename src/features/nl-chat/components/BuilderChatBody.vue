<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useNlChatSession, type NlChatEntityType } from '../composables/useNlChatSession'
import { useChatAttachments } from '../composables/useChatAttachments'
import { appendAttachments } from '../lib/attachmentPrompt'
import ChatMessageBubble from './ChatMessageBubble.vue'
import ChatAttachmentBar from './ChatAttachmentBar.vue'
import { useDrop } from '../../../core/composables/useDrop'
import { useAppSettings } from '../../../core/composables/useAppSettings'
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { resolveChatEnterToSend } from '../../../core/configs/appSettings'

// Body of the floating chat window for the creation flow (F0012): chat freely,
// the agent infers whether you want a Task / Pipeline / Agent and hands back a
// draft to review. The window shell (position, header, minimize) lives in
// ChatWindow.vue; this component only reports status up to it.

const props = defineProps<{ projectId?: string | null }>()
const emit = defineEmits<{
  close: []
  status: [{ kind: 'idle' | 'busy' | 'done' | 'error'; text: string }]
}>()

const {
  step,
  entityType,
  messages,
  draft,
  pipelineName,
  agentScope,
  sending,
  confirming,
  error,
  showLongChatNudge,
  catalogAgentIds,
  catalogError,
  sendMessage,
  confirm,
  cancel,
  reset,
  findInvalidPipelineAgentRefs,
} = useNlChatSession({ getProjectId: () => props.projectId ?? undefined })

const draftText = ref('')
const draftParseError = ref<string | null>(null)

watch(draft, (d) => {
  draftText.value = d ? JSON.stringify(d, null, 2) : ''
  draftParseError.value = null
})

const { t } = useI18nHelpers()
const inputText = ref('')

// Keep the newest message in view as the conversation grows; also the drop zone.
const messagesRef = ref<HTMLElement | null>(null)

// ── attachments ───────────────────────────────────────────────────────────
const attachments = useChatAttachments({ getProjectId: () => props.projectId ?? undefined })
const canAttach = computed(() => !sending.value && step.value !== 'done')
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

async function onSend(): Promise<void> {
  if (sending.value || step.value === 'done' || attachments.uploading.value) return
  const text = inputText.value.trim()
  if (!text && attachments.items.value.length === 0) return

  const uploaded = await attachments.upload()
  if (uploaded === null) return // upload failed — keep text + chips so it can be retried
  const finalText = appendAttachments(text, uploaded)

  inputText.value = ''
  attachments.clear()
  nextTick(autoGrow)
  void sendMessage(finalText)
}

const inputRef = ref<HTMLTextAreaElement | null>(null)
/** Grow with the text up to the CSS max-height, then scroll. */
function autoGrow(): void {
  const el = inputRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
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
    (entityType.value !== 'pipeline' || !pipelineAgentError.value) &&
    (entityType.value !== 'agent' || agentScope.value === 'global' || !!props.projectId),
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

defineExpose({ cancel, reset })

const ENTITY_LABELS: Record<NlChatEntityType, string> = {
  task: 'Task',
  pipeline: 'Pipeline',
  agent: 'Agent',
  automation: 'Automation',
}

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

const status = computed<{ kind: 'idle' | 'busy' | 'done' | 'error'; text: string }>(() => {
  if (sending.value || confirming.value) {
    return {
      kind: 'busy',
      text: confirming.value
        ? `Đang tạo… ${waitingSeconds.value}s`
        : `Agent đang suy nghĩ… ${waitingSeconds.value}s`,
    }
  }
  if (step.value === 'error' || error.value) return { kind: 'error', text: 'Có lỗi' }
  if (step.value === 'done') return { kind: 'done', text: 'Hoàn tất' }
  return { kind: 'idle', text: 'Sẵn sàng' }
})

watch(status, (s) => emit('status', s), { immediate: true })

watch([() => messages.value.length, () => sending.value], async () => {
  await nextTick()
  const el = messagesRef.value
  if (el) el.scrollTop = el.scrollHeight
})
</script>

<template>
  <template v-if="step === 'chatting' || step === 'confirming' || step === 'done' || step === 'error'">
    <div ref="messagesRef" class="nl-chat-messages" :class="{ 'is-drop-over': isOverDropZone }">
      <p v-if="isOverDropZone" class="nl-chat-drop-hint">{{ t('nlChat.attachment.dropHint') }}</p>
      <p v-if="messages.length === 0" class="nl-chat-hint">
        Mô tả điều bạn muốn — mình sẽ hỏi thêm nếu thiếu, rồi dựng draft Task, Pipeline hoặc Agent cho bạn.
      </p>
      <div v-for="(m, i) in messages" :key="i" class="nl-chat-row" :class="`nl-chat-row-${m.role}`">
        <span class="nl-chat-role">{{ m.role === 'user' ? 'Bạn' : 'Trợ lý' }}</span>
        <ChatMessageBubble :role="m.role === 'user' ? 'user' : 'assistant'" :text="m.text" />
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
        placeholder="Nhập tin nhắn..."
        :title="composerHint"
        :disabled="sending || step === 'done'"
        @input="autoGrow"
        @keydown.enter.exact="onEnterKey"
        @keydown.ctrl.enter.prevent="onSend"
        @keydown.meta.enter.prevent="onSend"
      ></textarea>
      <button
        type="submit"
        :disabled="
          sending ||
          step === 'done' ||
          attachments.uploading.value ||
          (!inputText.trim() && attachments.items.value.length === 0)
        "
      >
        Gửi
      </button>
    </form>
  </template>

  <div v-else-if="step === 'previewDraft'" class="nl-chat-preview">
    <p v-if="entityType" class="nl-chat-entity-badge">Draft {{ ENTITY_LABELS[entityType] }}</p>
    <label v-if="entityType === 'pipeline'" class="nl-chat-pipeline-name">
      Tên pipeline
      <input v-model="pipelineName" type="text" placeholder="Tên profile pipeline" />
    </label>
    <label v-if="entityType === 'agent'" class="nl-chat-agent-scope">
      Phạm vi agent
      <select v-model="agentScope">
        <option value="project">Chỉ project hiện tại</option>
        <option value="global">Toàn cục (mọi project)</option>
      </select>
    </label>
    <textarea v-model="draftText" class="nl-chat-draft-textarea" rows="14"></textarea>
    <p v-if="draftParseError" class="nl-chat-error">{{ draftParseError }}</p>
    <p v-if="entityType === 'pipeline' && pipelineAgentError" class="nl-chat-error">{{ pipelineAgentError }}</p>
    <p v-if="entityType === 'agent' && agentScope === 'project' && !props.projectId" class="nl-chat-error">
      Chưa chọn project ở header — chọn project hoặc đổi phạm vi agent sang "Toàn cục".
    </p>
    <div class="nl-chat-preview-actions">
      <button type="button" :disabled="!canConfirm || confirming" @click="onConfirm">Xác nhận & tạo</button>
      <button type="button" @click="onCancel">Huỷ</button>
    </div>
  </div>
</template>
