<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useNlChatSession, type NlChatEntityType } from '../composables/useNlChatSession'
import { useChatComposer } from '../composables/useChatComposer'
import ChatMessageBubble from './ChatMessageBubble.vue'
import ChatComposer from './ChatComposer.vue'
import DraftEditor from './DraftEditor.vue'
import Icon from '../../../frontend/ui/Icon.vue'
import { buildProfileOptions } from '../lib/taskDraftFields'
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'

// Body of the floating chat window for the creation flow (F0012). The window shell (position, header, minimize) lives in ChatWindow.vue; this component only reports status up to it.

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
  draftUpdatedByChat,
  draftAttachWarning,
  pipelineName,
  agentScope,
  sending,
  confirming,
  error,
  showLongChatNudge,
  catalogAgentIds,
  catalogError,
  catalogProfileNames,
  profileError,
  loadingProfiles,
  sendMessage,
  setDraft,
  undoDraftUpdate,
  dismissDraftUpdate,
  loadProfiles,
  confirm,
  cancel,
  reset,
  findInvalidPipelineAgentRefs,
  profileNameError,
} = useNlChatSession({ getProjectId: () => props.projectId ?? undefined })

const { t } = useI18nHelpers()

/** Lỗi tầng editor (JSON hỏng / field sai) — `DraftEditor` báo lên, chặn Xác nhận. */
const editorError = ref<string | null>(null)
/** Ở màn gộp, người dùng thu gọn hội thoại để nhường chỗ cho panel draft. */
const convoCollapsed = ref(false)
const isPreview = computed(() => step.value === 'previewDraft')

const profileModel = computed(() =>
  buildProfileOptions({
    names: catalogProfileNames.value,
    loading: loadingProfiles.value,
    hasError: !!profileError.value,
    current: typeof draft.value?.profileName === 'string' ? draft.value.profileName : '',
    defaultOptionLabel: t('nlChat.draft.profileDefaultOption'),
    unknownSuffix: t('nlChat.draft.profileUnknownSuffix'),
  }),
)

// Ô chat giờ cũng dùng để sửa draft, nên placeholder phải nói đúng việc đang làm.
const composerPlaceholder = computed(() =>
  isPreview.value ? t('nlChat.draft.composerPlaceholder') : 'Nhập tin nhắn...',
)

// Keep the newest message in view as the conversation grows; also the drop zone.
const messagesRef = ref<HTMLElement | null>(null)

// Attachments, drop zone, Enter behaviour and the send guard — shared with TaskChatBody, which only differs in what blocks a send and where text goes.
const composer = useChatComposer({
  dropZone: messagesRef,
  getProjectId: () => props.projectId ?? undefined,
  canSend: () => step.value !== 'done',
  sending: () => sending.value,
  send: (text) => void sendMessage(text),
})
const { isOverDropZone } = composer

// design.md §4.4: soát ngay trên object draft đang hiển thị, nên nút Xác nhận phản ứng ngay khi người dùng sửa/làm hỏng một agent ref, không đợi tới lúc nhận draft mới.
const pipelineAgentError = computed<string | null>(() => {
  if (entityType.value !== 'pipeline' || !isPreview.value) return null
  if (catalogError.value) return catalogError.value
  if (!catalogAgentIds.value) return 'Đang kiểm tra danh sách agent hợp lệ...'
  const invalid = findInvalidPipelineAgentRefs(draft.value)
  return invalid.length > 0 ? `Agent không tồn tại trong catalog: ${invalid.join(', ')}` : null
})

// Cùng lối với `pipelineAgentError`, cho `profileName` của draft task/automation — `profileNameError` giữ luôn thông điệp vì i18n của nl-chat chưa migrate.
const taskProfileError = computed<string | null>(() => {
  if (!isPreview.value) return null
  if (entityType.value !== 'task' && entityType.value !== 'automation') return null
  return profileNameError(draft.value, entityType.value)
})

const canConfirm = computed(
  () =>
    isPreview.value &&
    !editorError.value &&
    (entityType.value !== 'pipeline' || pipelineName.value.trim().length > 0) &&
    (entityType.value !== 'pipeline' || !pipelineAgentError.value) &&
    !taskProfileError.value &&
    (entityType.value !== 'agent' || agentScope.value === 'global' || !!props.projectId),
)

function onConfirm(): void {
  if (!draft.value) return
  // Draft luôn là object đã đồng bộ với cả hai view — không còn chuỗi nào để parse ở đây.
  void confirm(draft.value)
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

// A turn is a CLI round trip that can take tens of seconds, so "đang suy nghĩ" alone reads as frozen — the elapsed counter is the progress signal.
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
  // `step === 'error'` can arrive without any message, hence the fallback text.
  if (step.value === 'error' || error.value) {
    return { kind: 'error', text: error.value ? `Có lỗi: ${error.value}` : 'Có lỗi' }
  }
  if (step.value === 'done') return { kind: 'done', text: 'Hoàn tất' }
  return { kind: 'idle', text: 'Sẵn sàng' }
})

watch(status, (s) => emit('status', s), { immediate: true })

/** Within this many px of the bottom counts as "still following the tail" (see TaskChatBody.vue). */
const SCROLL_BOTTOM_THRESHOLD = 48

function isNearBottom(): boolean {
  const el = messagesRef.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_BOTTOM_THRESHOLD
}

// Measured before the new message/typing-dots are patched into the DOM (default `watch` flush is 'pre') — only follow the tail when already at it, so reading older history isn't fought.
watch([() => messages.value.length, () => sending.value], async () => {
  if (!isNearBottom()) return
  await nextTick()
  const el = messagesRef.value
  if (el) el.scrollTop = el.scrollHeight
})
</script>

<template>
  <!-- Màn gộp: hội thoại + panel draft + composer cùng một lúc. Chỉ panel draft là
       `v-if`; khối messages và ChatComposer VÔ ĐIỀU KIỆN, vì chính nhánh template
       loại trừ nhau trước đây là thứ làm ô chat biến mất ở bước preview. -->
  <div v-if="isPreview" class="nl-chat-convo-bar">
    <button
      type="button"
      class="icon-btn icon-btn-inline"
      :title="
        convoCollapsed
          ? t('nlChat.draft.conversationExpand')
          : t('nlChat.draft.conversationCollapse')
      "
      :aria-label="
        convoCollapsed
          ? t('nlChat.draft.conversationExpand')
          : t('nlChat.draft.conversationCollapse')
      "
      :aria-expanded="!convoCollapsed"
      @click="convoCollapsed = !convoCollapsed"
    >
      <Icon :name="convoCollapsed ? 'chevronRight' : 'chevronLeft'" :size="12" />
    </button>
    <span>{{ t('nlChat.draft.conversationTitle', { count: messages.length }) }}</span>
  </div>

  <!-- Thu gọn bằng CLASS (`display: none`), không `v-if`/`v-show` có điều kiện gỡ
       phần tử: `useDrop` giữ `messagesRef`, mất ref là thả file vào cửa sổ hết tác dụng. -->
  <div
    ref="messagesRef"
    class="nl-chat-messages"
    :class="{
      'is-drop-over': isOverDropZone,
      'nl-chat-messages--compact': isPreview,
      'nl-chat-messages--hidden': isPreview && convoCollapsed,
    }"
  >
    <p v-if="isOverDropZone" class="nl-chat-drop-hint">{{ t('nlChat.attachment.dropHint') }}</p>
    <p v-if="messages.length === 0" class="nl-chat-hint">
      Mô tả điều bạn muốn — mình sẽ hỏi thêm nếu thiếu, rồi dựng draft Task, Pipeline hoặc Agent cho
      bạn.
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
    <p v-if="showLongChatNudge" class="nl-chat-nudge">Có thể mô tả gọn lại giúp mình không?</p>
    <p v-if="error" class="nl-chat-error">{{ error }}</p>
    <p v-if="step === 'done'" class="nl-chat-done">Đã tạo thành công.</p>
  </div>

  <div v-if="isPreview" class="nl-chat-preview">
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
    <DraftEditor
      :draft="draft ?? {}"
      :entity-type="entityType"
      :profile="profileModel"
      :profile-error-text="profileError"
      :chat-updated="draftUpdatedByChat"
      :attach-warning="draftAttachWarning"
      :disabled="sending || confirming"
      @update:draft="setDraft"
      @update:editor-error="editorError = $event"
      @undo="undoDraftUpdate"
      @dismiss-banner="dismissDraftUpdate"
      @retry-profiles="loadProfiles"
    />
    <p v-if="entityType === 'pipeline' && pipelineAgentError" class="nl-chat-error">
      {{ pipelineAgentError }}
    </p>
    <p v-if="taskProfileError" class="nl-chat-error">{{ taskProfileError }}</p>
    <p
      v-if="entityType === 'agent' && agentScope === 'project' && !props.projectId"
      class="nl-chat-error"
    >
      Chưa chọn project ở header — chọn project hoặc đổi phạm vi agent sang "Toàn cục".
    </p>
    <div class="nl-chat-preview-actions">
      <button type="button" :disabled="!canConfirm || confirming" @click="onConfirm">
        Xác nhận & tạo
      </button>
      <button type="button" @click="onCancel">Huỷ</button>
    </div>
  </div>

  <ChatComposer :composer="composer" :placeholder="composerPlaceholder" />
</template>
