<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'
import {
  createKnowledgeTag,
  renameKnowledgeTag,
  saveKnowledgeTag,
  type KnowledgeTagFacetView,
} from '../scripts/KnowledgePanelApi'
import { TAG_COLORS } from '../schemas/knowledge'

/**
 * Tạo / sửa tag: tên + màu + mô tả. Gộp luôn cụm "đổi tên tag" vốn nằm rời ở
 * cột trái — đổi tên là một thuộc tính của tag, không phải một công cụ riêng.
 */
const props = defineProps<{
  /** `null` = tạo mới. */
  tag: KnowledgeTagFacetView | null
  projectId?: string
}>()

const emit = defineEmits<{
  close: []
  saved: [tag: string, created: boolean]
  /** Có rewrite front-matter: cha phải nạp lại danh sách entry, không chỉ tag. */
  renamed: [count: number, metaError: string]
}>()

const { t } = useI18nHelpers()

const isEdit = computed(() => !!props.tag)

const name = ref(props.tag?.tag ?? '')
const renameTo = ref('')
const color = ref<string>(props.tag?.color ?? 'slate')
const description = ref(props.tag?.description ?? '')
// Sửa tag phải ghi lại đúng store đang giữ metadata, nếu không một tag global
// sẽ đẻ thêm một hàng project mang cùng tên và màu của nó thắng ở mọi project.
const scope = ref(props.tag?.scope ?? 'project')
const saving = ref(false)
const error = ref('')

function colorStyle(c: string) {
  return { '--tag-c': `var(--tag-${c})`, '--tag-c-rgb': `var(--tag-${c}-rgb)` }
}

async function save() {
  if (saving.value) return
  saving.value = true
  error.value = ''
  try {
    if (!props.tag) {
      const data = await createKnowledgeTag(
        { tag: name.value.trim(), color: color.value, description: description.value, scope: scope.value },
        props.projectId,
      )
      emit('saved', data.tag.tag, true)
      return
    }

    const next = renameTo.value.trim()
    if (!next || next === props.tag.tag) {
      await saveKnowledgeTag(
        props.tag.tag,
        { color: color.value, description: description.value, scope: scope.value },
        props.projectId,
      )
      emit('saved', props.tag.tag, false)
      return
    }

    // `rename` đã tự dời metadata sang tên mới (cùng transaction), nên bước
    // `PUT` sau đây chỉ để áp màu người dùng vừa chọn. Hỏng bước hai thì
    // tag mới giữ nguyên màu cũ — không entry nào mất, không hàng mồ côi —
    // nên báo ra rồi vẫn coi là thành công.
    const renamed = await renameKnowledgeTag(props.tag.tag, next, props.projectId)
    let metaError = ''
    try {
      await saveKnowledgeTag(
        next,
        { color: color.value, description: description.value, scope: scope.value },
        props.projectId,
      )
    } catch (e: any) {
      metaError = String(e.message || e)
    }
    emit('renamed', renamed.renamed ?? 0, metaError)
  } catch (e: any) {
    error.value = String(e.message || e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal knowledge-tag-dialog" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h3>
          {{ isEdit
            ? t('knowledge.tags.dialog.editTitle', { tag: tag?.tag })
            : t('knowledge.tags.dialog.createTitle') }}
        </h3>
        <button
          type="button"
          class="modal-close"
          :title="t('knowledge.form.close')"
          :aria-label="t('knowledge.form.close')"
          @click="emit('close')"
        >
          ✕
        </button>
      </div>

      <div class="modal-body knowledge-tag-body">
        <label v-if="!isEdit" class="cfg-label">
          {{ t('knowledge.tags.dialog.name') }}
          <input v-model="name" class="cfg-input" :placeholder="t('knowledge.tags.dialog.namePlaceholder')" />
        </label>
        <label v-else class="cfg-label">
          {{ t('knowledge.tags.dialog.renameTo') }}
          <input v-model="renameTo" class="cfg-input" :placeholder="tag?.tag" />
          <span class="muted knowledge-tag-hint">{{ t('knowledge.tags.dialog.renameHint') }}</span>
        </label>

        <div class="cfg-label">
          <span>{{ t('knowledge.tags.dialog.color') }}</span>
          <!-- Palette token cố định: mỗi token khai hai giá trị theo `[data-theme]`
               nên chip tương phản đúng ở cả hai theme. Giá trị gửi lên là TÊN token. -->
          <div class="knowledge-color-row">
            <button
              v-for="c in TAG_COLORS"
              :key="c"
              type="button"
              class="icon-btn knowledge-color-swatch"
              :class="{ active: color === c }"
              :style="colorStyle(c)"
              :title="t(`knowledge.tags.colors.${c}`)"
              :aria-label="t(`knowledge.tags.colors.${c}`)"
              @click="color = c"
            />
          </div>
        </div>

        <label class="cfg-label">
          {{ t('knowledge.tags.dialog.description') }}
          <input v-model="description" class="cfg-input" />
        </label>
        <label class="cfg-label">
          {{ t('knowledge.tags.dialog.scope') }}
          <select v-model="scope" class="cfg-input">
            <option value="project">project</option>
            <option value="global">global</option>
          </select>
        </label>

        <p v-if="error" class="err">{{ error }}</p>
      </div>

      <div class="modal-foot">
        <button
          type="button"
          class="btn-primary"
          :disabled="saving || (!isEdit && !name.trim())"
          @click="save"
        >{{ t('knowledge.actions.save') }}</button>
        <button type="button" class="btn-ghost" @click="emit('close')">{{ t('knowledge.form.cancel') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.knowledge-tag-dialog {
  width: min(480px, calc(100vw - 32px));
}
.knowledge-tag-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: min(76vh, 760px);
  overflow-y: auto;
}
.knowledge-tag-hint { font-size: 11px; }
.knowledge-color-row { display: flex; flex-wrap: wrap; gap: 4px; }
.knowledge-color-swatch {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--tag-c);
  border: 2px solid transparent;
}
.knowledge-color-swatch:hover:not(:disabled) { transform: scale(1.15); }
.knowledge-color-swatch.active { border-color: var(--text); }
</style>
