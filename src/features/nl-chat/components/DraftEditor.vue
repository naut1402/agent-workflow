<script setup lang="ts">
import { computed, ref, toRaw, watch } from 'vue'
import TaskDraftForm from './TaskDraftForm.vue'
import Icon from '../../../frontend/ui/Icon.vue'
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'
import { fieldErrors, type ProfileSelectModel } from '../lib/taskDraftFields'
import type { NlChatEntityType } from '../composables/useNlChatSession'

/**
 * Vỏ của panel draft: toggle `JSON view` ⇄ `Form view`, ô JSON + lỗi parse,
 * banner "đã cập nhật theo chat" + Hoàn tác.
 *
 * Nguồn chân lý là object `draft` ở composable; hai view chỉ là hai cách chiếu
 * của nó. Mọi thay đổi đi ra bằng `update:draft` với một object MỚI.
 */

const props = defineProps<{
  draft: Record<string, unknown>
  entityType: NlChatEntityType | null
  profile: ProfileSelectModel
  profileErrorText: string | null
  /** `draftUpdatedByChat` — lượt chat vừa rồi đã thay draft. */
  chatUpdated: boolean
  /** `draftAttachWarning` — draft bị bỏ khỏi message vì quá dài. */
  attachWarning: boolean
  disabled: boolean
}>()

const emit = defineEmits<{
  'update:draft': [Record<string, unknown>]
  /** null = không có lỗi tầng editor; chuỗi = lý do chặn Xác nhận. */
  'update:editorError': [string | null]
  undo: []
  'dismiss-banner': []
  'retry-profiles': []
}>()

const { t } = useI18nHelpers()

/** Mặc định JSON view; lựa chọn chỉ cần nhớ trong phiên (mọi session vẫn mount). */
const viewMode = ref<'json' | 'form'>('json')
const jsonText = ref('')
const jsonParseError = ref<string | null>(null)

/** Chỉ draft `task` có form; pipeline/agent/automation giữ JSON view. */
const formEnabled = computed(() => props.entityType === 'task')
const errors = computed(() => (formEnabled.value ? fieldErrors(props.draft) : {}))

/** Object vừa emit từ ô JSON — dùng để nhận ra "tiếng vọng của chính mình". */
let lastJsonEmit: Record<string, unknown> | null = null

watch(
  () => props.draft,
  (d) => {
    // Chính mình vừa emit ⇒ KHÔNG viết lại ô: viết lại là con trỏ nhảy về đầu và
    // chuỗi người dùng đang gõ bị thay bằng bản `JSON.stringify` chuẩn hoá.
    // So sánh qua `toRaw`: object đi vòng qua prop có thể về đây dưới dạng proxy
    // reactive, lúc đó `===` với bản thô luôn sai và watcher ghi đè nhầm.
    if (d && toRaw(d) === lastJsonEmit) return
    // Nhận một draft KHÔNG phải tiếng vọng ⇒ quên dấu cũ đi. `undoDraftUpdate()`
    // khôi phục bằng CHÍNH tham chiếu đã chụp, nên bản người dùng từng gõ ở ô JSON
    // có thể quay lại lần thứ hai; giữ dấu cũ là lần đó bị coi nhầm là tiếng vọng
    // và ô JSON kẹt ở bản của agent trong khi form + `confirm()` dùng bản khác.
    lastJsonEmit = null
    jsonText.value = d ? JSON.stringify(d, null, 2) : ''
    jsonParseError.value = null
  },
  { immediate: true },
)

function onJsonInput(): void {
  try {
    const parsed = JSON.parse(jsonText.value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      // `applyFieldChange` và `CreateTaskRequest` đều giả định object.
      jsonParseError.value = t('nlChat.draft.jsonNotObject')
      return
    }
    jsonParseError.value = null
    lastJsonEmit = parsed
    emit('update:draft', parsed)
  } catch {
    jsonParseError.value = t('nlChat.draft.jsonInvalid')
    // 🚫 KHÔNG emit: draft giữ bản hợp lệ gần nhất, Xác nhận bị chặn bởi editorError.
  }
}

/** Chiều form → JSON cố ý đi qua watcher ở trên, nên bật sang JSON view là thấy ngay bản mới. */
function onFormUpdate(next: Record<string, unknown>): void {
  emit('update:draft', next)
}

const formBlocked = computed(() => jsonParseError.value !== null)

function showForm(): void {
  if (formBlocked.value) return // guard thứ hai, phòng khi `:disabled` bị bỏ qua
  viewMode.value = 'form'
}

// Một watcher duy nhất báo lỗi lên cha, thứ tự ưu tiên cố định: JSON hỏng thì
// lỗi field chưa có nghĩa gì (draft đang là bản hợp lệ gần nhất, không phải bản trên ô).
watch(
  [jsonParseError, errors],
  ([parseErr, fieldErrs]) => {
    if (parseErr) return emit('update:editorError', parseErr)
    const firstKey = Object.keys(fieldErrs)[0]
    if (firstKey) return emit('update:editorError', t('nlChat.draft.hasFieldError'))
    emit('update:editorError', null)
  },
  { immediate: true, deep: true },
)
</script>

<template>
  <div class="nl-chat-draft-editor">
    <div
      v-if="formEnabled"
      class="nl-chat-view-toggle"
      role="group"
      :aria-label="t('nlChat.draft.viewToggleLabel')"
    >
      <button type="button" :aria-pressed="viewMode === 'json'" @click="viewMode = 'json'">
        {{ t('nlChat.draft.jsonView') }}
      </button>
      <button
        type="button"
        :aria-pressed="viewMode === 'form'"
        :disabled="formBlocked"
        :title="formBlocked ? t('nlChat.draft.formBlockedHint') : t('nlChat.draft.formView')"
        @click="showForm"
      >
        {{ t('nlChat.draft.formView') }}
      </button>
    </div>

    <div v-if="chatUpdated" class="nl-chat-draft-banner" role="status">
      <span>{{ t('nlChat.draft.updatedByChat') }}</span>
      <button type="button" class="nl-chat-draft-undo" @click="emit('undo')">
        {{ t('nlChat.draft.undo') }}
      </button>
      <button
        type="button"
        class="icon-btn icon-btn-inline"
        :title="t('nlChat.draft.dismiss')"
        :aria-label="t('nlChat.draft.dismiss')"
        @click="emit('dismiss-banner')"
      >
        <Icon name="close" :size="12" />
      </button>
    </div>
    <p v-if="attachWarning" class="nl-chat-nudge">{{ t('nlChat.draft.attachTooLong') }}</p>

    <div
      class="nl-chat-draft-body"
      :class="`nl-chat-draft-body--${formEnabled ? viewMode : 'json'}`"
    >
      <textarea
        v-if="viewMode === 'json' || !formEnabled"
        v-model="jsonText"
        class="nl-chat-draft-textarea"
        :disabled="disabled"
        :aria-label="t('nlChat.draft.jsonLabel')"
        @input="onJsonInput"
      ></textarea>
      <TaskDraftForm
        v-else
        :draft="draft"
        :profile="profile"
        :profile-error-text="profileErrorText"
        :errors="errors"
        :disabled="disabled"
        @update:draft="onFormUpdate"
        @retry-profiles="emit('retry-profiles')"
      />
    </div>
    <p v-if="jsonParseError" class="nl-chat-error" role="alert">{{ jsonParseError }}</p>
  </div>
</template>
