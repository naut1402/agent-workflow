<script setup lang="ts">
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'
import { ref } from 'vue'
import MarkdownTextEditor from '../../../frontend/ui/MarkdownTextEditor.vue'

export interface KnowledgeDraft {
  title: string
  slug: string
  scope: string
  tags: string[]
  content: string
}

defineProps<{
  selectedId: string | null
  allTags: { tag: string; count: number }[]
  message: string
  error: string
}>()

const draft = defineModel<KnowledgeDraft>('draft', { required: true })

const emit = defineEmits<{ close: []; save: []; delete: [] }>()

const { t } = useI18nHelpers()
const tagInput = ref('')

function addTag() {
  const tag = tagInput.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
  if (tag && !draft.value.tags.includes(tag)) draft.value.tags.push(tag)
  tagInput.value = ''
}

function removeTag(i: number) {
  draft.value.tags.splice(i, 1)
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal knowledge-form-dialog" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h3>{{ selectedId ? t('knowledge.form.editTitle', { id: selectedId }) : t('knowledge.form.createTitle') }}</h3>
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

      <div class="modal-body knowledge-form-body">
        <label class="cfg-label">
          {{ t('knowledge.fields.title') }}
          <input v-model="draft.title" class="cfg-input" />
        </label>
        <label class="cfg-label">
          {{ t('knowledge.fields.slug') }}
          <input v-model="draft.slug" class="cfg-input" :disabled="!!selectedId" :placeholder="t('knowledge.fields.slugPlaceholder')" />
        </label>
        <label class="cfg-label">
          {{ t('knowledge.fields.scope') }}
          <!-- Khoá khi sửa: scope nằm trong id, đổi scope là đổi id và phá mọi
               `knowledge_inputs` đang trỏ tới entry này. -->
          <select v-model="draft.scope" class="cfg-input" :disabled="!!selectedId">
            <option value="project">project</option>
            <option value="system">system</option>
            <option value="global">global</option>
          </select>
        </label>
        <label class="cfg-label">
          {{ t('knowledge.fields.tags') }}
          <div class="tag-row">
            <span
              v-for="(tag, i) in draft.tags"
              :key="tag"
              class="chip chip-rm"
              @click="removeTag(i)"
            >{{ tag }} ✕</span>
          </div>
          <div class="tag-input-row">
            <input
              v-model="tagInput"
              class="cfg-input cfg-input-sm"
              list="knowledge-tag-suggestions"
              :placeholder="t('knowledge.fields.addTagPlaceholder')"
              @keydown.enter.prevent="addTag"
            />
            <datalist id="knowledge-tag-suggestions">
              <option v-for="tag in allTags" :key="tag.tag" :value="tag.tag" />
            </datalist>
            <button class="btn-ghost btn-sm" type="button" @click="addTag">+</button>
          </div>
        </label>
        <div class="cfg-label knowledge-content-label">
          <span>{{ t('knowledge.fields.content') }}</span>
          <MarkdownTextEditor v-model="draft.content" height="400px" />
        </div>
      </div>

      <div class="modal-foot">
        <button v-if="selectedId" type="button" class="btn-ghost btn-danger" @click="emit('delete')">
          {{ t('knowledge.actions.delete') }}
        </button>
        <span v-if="message" class="save-msg">{{ message }}</span>
        <span v-if="error" class="err">{{ error }}</span>
        <button type="button" class="btn-ghost" @click="emit('close')">{{ t('knowledge.form.cancel') }}</button>
        <button type="button" class="btn-primary" @click="emit('save')">{{ t('knowledge.actions.save') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.knowledge-form-dialog {
  width: min(720px, calc(100vw - 32px));
}
.knowledge-form-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: min(76vh, 760px);
  overflow-y: auto;
}
/* flex:1 + min-height:<content> lets the label shrink below Toast UI height,
   so the editor overflows and covers the actions row (esp. visible in light theme). */
.knowledge-content-label {
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
}
.modal-foot {
  flex-wrap: wrap;
}
</style>
