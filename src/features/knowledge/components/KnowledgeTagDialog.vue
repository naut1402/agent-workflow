<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'
import { useApiAction } from '../../../frontend/composables/useApiAction'
import CDialog from '../../../frontend/ui/CDialog.vue'
import {
  createKnowledgeTag,
  renameKnowledgeTag,
  saveKnowledgeTag,
  type KnowledgeTagFacetView,
} from '../scripts/KnowledgePanelApi'
import { TAG_COLORS } from '../schemas/knowledge'

const props = defineProps<{
  tag: KnowledgeTagFacetView | null
  projectId?: string
}>()

const emit = defineEmits<{
  close: []
  saved: [tag: string, created: boolean]
  renamed: [count: number, metaError: string]
}>()

const { t } = useI18nHelpers()

const isEdit = computed(() => !!props.tag)

const name = ref(props.tag?.tag ?? '')
const renameTo = ref('')
const color = ref<string>(props.tag?.color ?? 'slate')
const description = ref(props.tag?.description ?? '')
// xem docs/architecture/code/knowledge.md §7
const scope = ref(props.tag?.scope ?? 'project')
const { pending: saving, run: runSave } = useApiAction()
const error = ref('')

function colorStyle(c: string) {
  return { '--tag-c': `var(--tag-${c})`, '--tag-c-rgb': `var(--tag-${c}-rgb)` }
}

async function save() {
  await runSave(async () => {
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

      // xem docs/architecture/code/knowledge.md §6
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
    }
  })
}
</script>

<template>
  <CDialog
    class="knowledge-tag-dialog"
    :title="isEdit
      ? t('knowledge.tags.dialog.editTitle', { tag: tag?.tag })
      : t('knowledge.tags.dialog.createTitle')"
    :loading="saving"
    width="min(480px, calc(100vw - 32px))"
    @close="emit('close')"
  >
    <div class="knowledge-tag-body">
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

    <template #footer>
      <div class="modal-foot">
        <button
          type="button"
          class="btn-primary"
          :disabled="saving || (!isEdit && !name.trim())"
          @click="save"
        >{{ t('knowledge.actions.save') }}</button>
        <button type="button" class="btn-ghost" @click="emit('close')">{{ t('knowledge.form.cancel') }}</button>
      </div>
    </template>
  </CDialog>
</template>

<style scoped lang="scss">
.knowledge-tag-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
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
