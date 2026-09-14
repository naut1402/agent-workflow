<script setup lang="ts">
import { ref } from 'vue'
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'
import { uploadKnowledgeFile } from '../scripts/KnowledgePanelApi'

/** Hộp upload inline cũ, chuyển nguyên nội dung vào dialog (trigger là icon button). */
const props = defineProps<{ projectId?: string }>()

const emit = defineEmits<{ close: []; uploaded: [id: string] }>()

const { t } = useI18nHelpers()

const scope = ref('project')
const tags = ref('')
const uploading = ref(false)
const error = ref('')

async function onFileUpload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  uploading.value = true
  error.value = ''
  try {
    const parsed = tags.value.split(/[,;]+/).map((s) => s.trim()).filter(Boolean)
    const data = await uploadKnowledgeFile(file, {
      scope: scope.value,
      tags: parsed,
      projectId: props.projectId,
    })
    emit('uploaded', data.entry.id)
  } catch (e: any) {
    error.value = String(e.message || e)
  } finally {
    uploading.value = false
    // Reset để chọn lại đúng file vừa hỏng vẫn bắn `change`.
    input.value = ''
  }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal knowledge-upload-dialog" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h3>{{ t('knowledge.upload.title') }}</h3>
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

      <div class="modal-body knowledge-upload-body">
        <label class="cfg-label">
          {{ t('knowledge.upload.scope') }}
          <select v-model="scope" class="cfg-input">
            <option value="project">project</option>
            <option value="system">system</option>
            <option value="global">global</option>
          </select>
        </label>
        <label class="cfg-label">
          {{ t('knowledge.upload.tags') }}
          <input v-model="tags" class="cfg-input" placeholder="pipeline, vue" />
        </label>
        <label class="cfg-label">
          {{ t('knowledge.upload.file') }}
          <input
            type="file"
            accept=".md,.txt,text/plain,text/markdown"
            :disabled="uploading"
            @change="onFileUpload"
          />
        </label>
        <p v-if="uploading" class="muted">{{ t('knowledge.upload.uploading') }}</p>
        <p v-if="error" class="err">{{ error }}</p>
      </div>

      <div class="modal-foot">
        <button type="button" class="btn-ghost" @click="emit('close')">{{ t('knowledge.form.cancel') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.knowledge-upload-dialog {
  width: min(480px, calc(100vw - 32px));
}
.knowledge-upload-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: min(76vh, 760px);
  overflow-y: auto;
}
</style>
