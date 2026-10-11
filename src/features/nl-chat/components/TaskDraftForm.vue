<script setup lang="ts">
import { computed, useId } from 'vue'
import CSelect from '../../../frontend/ui/CSelect.vue'
import Icon from '../../../frontend/ui/Icon.vue'
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'
import {
  applyFieldChange,
  jsonOnlyKeys,
  toFieldValue,
  visibleFields,
  type ProfileSelectModel,
  type TaskDraftFieldDef,
  type TaskDraftFieldError,
} from '../lib/taskDraftFields'

/**
 * Form view của draft task — CONTROLLED hoàn toàn: không ref nội bộ nào giữ giá
 * trị field, mọi thay đổi đi ra bằng `update:draft` với một object MỚI.
 *
 * Form chỉ render; luật map draft ⇄ control nằm ở `lib/taskDraftFields.ts` để
 * test được mà không cần DOM.
 */

const props = defineProps<{
  draft: Record<string, unknown>
  profile: ProfileSelectModel
  /** `profileError` của composable — đã là chuỗi hiển thị. */
  profileErrorText: string | null
  errors: Record<string, TaskDraftFieldError>
  /** true khi đang gửi / đang tạo. */
  disabled: boolean
}>()

const emit = defineEmits<{
  'update:draft': [Record<string, unknown>]
  'retry-profiles': []
}>()

const { t } = useI18nHelpers()

// Id cục bộ cho cặp label/control và cho `name` của nhóm radio: nhiều phiên chat
// cùng mount một lúc (`v-show`), trùng `name` là radio của phiên này điều khiển
// phiên kia.
const uid = `nl-draft-${useId()}`

const fields = computed(() => visibleFields(props.draft))
const jsonOnly = computed(() => jsonOnlyKeys(props.draft))

const selectDisabled = computed(
  () => props.disabled || props.profile.state === 'loading' || props.profile.state === 'error',
)
const selectPlaceholder = computed(() =>
  props.profile.state === 'loading' ? t('nlChat.draft.profileLoading') : '',
)

function fieldLabel(def: TaskDraftFieldDef): string {
  return t(`nlChat.draft.field.${def.labelKey}`)
}

function errorText(def: TaskDraftFieldDef): string {
  const err = props.errors[def.key]
  return t(`nlChat.draft.error.${err.code}`, { max: err.max, min: err.min })
}

function textValue(def: TaskDraftFieldDef): string {
  return String(toFieldValue(props.draft, def))
}

function boolValue(def: TaskDraftFieldDef): boolean {
  return toFieldValue(props.draft, def) === true
}

function listValue(def: TaskDraftFieldDef): string[] {
  const value = toFieldValue(props.draft, def)
  return Array.isArray(value) ? value : []
}

function onFieldChange(def: TaskDraftFieldDef, value: string | boolean | string[]): void {
  emit('update:draft', applyFieldChange(props.draft, def, value))
}

function onInputChange(def: TaskDraftFieldDef, e: Event): void {
  onFieldChange(def, (e.target as HTMLInputElement | HTMLTextAreaElement).value)
}

function onCheckboxChange(def: TaskDraftFieldDef, e: Event): void {
  onFieldChange(def, (e.target as HTMLInputElement).checked)
}

/** Chỉ XOÁ phần tử — thêm knowledge đã có picker ở composer, không nhân bản vào đây. */
function removeListItem(def: TaskDraftFieldDef, index: number): void {
  onFieldChange(
    def,
    listValue(def).filter((_, i) => i !== index),
  )
}
</script>

<template>
  <div class="nl-chat-draft-form">
    <div
      v-for="def in fields"
      :key="def.key"
      class="nl-chat-field"
      :class="`nl-chat-field--${def.kind}`"
    >
      <template v-if="def.kind === 'text' || def.kind === 'textarea'">
        <label class="nl-chat-field-label" :for="`${uid}-${def.key}`">{{ fieldLabel(def) }}</label>
        <input
          v-if="def.kind === 'text'"
          :id="`${uid}-${def.key}`"
          type="text"
          :value="textValue(def)"
          :disabled="disabled"
          @change="onInputChange(def, $event)"
        />
        <!-- `@change` chứ không `@input`: mỗi phím gõ emit một object draft mới là
             lãng phí, và cha sẽ viết lại ô ngay giữa lúc đang gõ. -->
        <textarea
          v-else
          :id="`${uid}-${def.key}`"
          rows="4"
          :value="textValue(def)"
          :disabled="disabled"
          @change="onInputChange(def, $event)"
        ></textarea>
      </template>

      <!-- 🚫 Không bọc CSelect trong <label>: nó tự xử lý click dội từ label, nhưng
           đừng dựa vào đó — nhãn đi bằng <span> + aria-label. -->
      <template v-else-if="def.kind === 'select'">
        <span class="nl-chat-field-label">{{ fieldLabel(def) }}</span>
        <CSelect
          class="nl-chat-field-select"
          :model-value="textValue(def)"
          :options="profile.options"
          :disabled="selectDisabled"
          :placeholder="selectPlaceholder"
          :aria-label="fieldLabel(def)"
          @update:model-value="onFieldChange(def, $event)"
        />
      </template>

      <template v-else-if="def.kind === 'enum'">
        <span class="nl-chat-field-label">{{ fieldLabel(def) }}</span>
        <div class="nl-chat-field-radios">
          <label v-for="opt in def.options" :key="opt" class="nl-chat-field-radio">
            <input
              type="radio"
              :name="`${uid}-${def.key}`"
              :value="opt"
              :checked="textValue(def) === opt"
              :disabled="disabled"
              @change="onFieldChange(def, opt)"
            />
            <span>{{ t(`nlChat.draft.${def.labelKey}.${opt}`) }}</span>
          </label>
        </div>
      </template>

      <template v-else-if="def.kind === 'boolean'">
        <label class="nl-chat-field-check">
          <input
            type="checkbox"
            :checked="boolValue(def)"
            :disabled="disabled"
            @change="onCheckboxChange(def, $event)"
          />
          <span class="nl-chat-field-label">{{ fieldLabel(def) }}</span>
        </label>
      </template>

      <template v-else-if="def.kind === 'stringList'">
        <span class="nl-chat-field-label">{{ fieldLabel(def) }}</span>
        <div class="nl-chat-field-chips">
          <span v-for="(item, i) in listValue(def)" :key="`${item}-${i}`" class="chip">
            {{ item }}
            <button
              type="button"
              class="icon-btn icon-btn-inline"
              :title="t('nlChat.draft.knowledgeRemove')"
              :aria-label="t('nlChat.draft.knowledgeRemove')"
              :disabled="disabled"
              @click="removeListItem(def, i)"
            >
              <Icon name="close" :size="10" />
            </button>
          </span>
          <span v-if="listValue(def).length === 0" class="nl-chat-hint">{{
            t('nlChat.draft.knowledgeEmpty')
          }}</span>
        </div>
      </template>

      <p v-if="errors[def.key]" class="nl-chat-field-error" role="alert">{{ errorText(def) }}</p>

      <!-- Bốn trạng thái của select pipeline: "chưa biết catalog" phải phân biệt
           được với "catalog rỗng", nếu không người dùng tưởng project không có
           profile nào trong khi thật ra chỉ là tải hỏng. -->
      <template v-if="def.key === 'profileName'">
        <template v-if="profile.state === 'error'">
          <p class="nl-chat-error">{{ profileErrorText }}</p>
          <button
            type="button"
            class="nl-chat-profile-retry"
            :disabled="disabled"
            @click="emit('retry-profiles')"
          >
            {{ t('nlChat.draft.profileRetry') }}
          </button>
        </template>
        <!-- `loading` cần dòng chữ riêng: `CSelect` khớp option mặc định ở vị trí 0
             trước khi rơi về `placeholder`, nên với draft chưa có `profileName` cái
             placeholder kia không bao giờ hiện. Thiếu dòng này thì `loading` là
             trạng thái duy nhất người dùng không đọc được, chỉ khác ở `disabled`. -->
        <p v-else-if="profile.state === 'loading'" class="nl-chat-hint">
          {{ t('nlChat.draft.profileLoading') }}
        </p>
        <p v-else-if="profile.state === 'empty'" class="nl-chat-hint">
          {{ t('nlChat.draft.profileEmptyHint') }}
        </p>
      </template>
    </div>

    <!-- Thà nói thẳng còn hơn để người dùng tưởng form là toàn bộ draft. -->
    <p v-if="jsonOnly.length > 0" class="nl-chat-hint nl-chat-json-only">
      {{ t('nlChat.draft.jsonOnlyFields', { keys: jsonOnly.join(', ') }) }}
    </p>
  </div>
</template>
