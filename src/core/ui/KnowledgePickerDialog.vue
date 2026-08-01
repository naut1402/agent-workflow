<script setup lang="ts">
// Reusable knowledge multi-select + upload dialog for create-task and pipeline editor.
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { fetchKnowledgeList, uploadKnowledgeFile } from '../../features/knowledge/scripts/knowledgeApi'

const props = defineProps<{
  /** Entry ids already selected (`scope/slug`). */
  modelValue: string[]
  projectId?: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [ids: string[]]
  close: []
}>()

const { t } = useI18n()

const entries = ref<
  { id: string; title: string; scope: string; tags?: string[] }[]
>([])
const query = ref('')
const loading = ref(false)
const error = ref('')
const uploading = ref(false)
const uploadTags = ref('')

const selected = computed({
  get: () => new Set(props.modelValue),
  set: (s: Set<string>) => emit('update:modelValue', [...s]),
})

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return entries.value
  return entries.value.filter(
    (e) =>
      e.id.toLowerCase().includes(q) ||
      e.title?.toLowerCase().includes(q) ||
      e.tags?.some((tag) => tag.toLowerCase().includes(q)),
  )
})

async function loadEntries() {
  loading.value = true
  error.value = ''
  try {
    const data = await fetchKnowledgeList({ projectId: props.projectId ?? undefined })
    entries.value = data.entries || []
  } catch (e: unknown) {
    error.value = String((e as Error)?.message ?? e)
    entries.value = []
  } finally {
    loading.value = false
  }
}

function toggle(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

async function onUpload(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  uploading.value = true
  error.value = ''
  try {
    const tags = uploadTags.value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const data = await uploadKnowledgeFile(file, {
      scope: 'project',
      tags,
      projectId: props.projectId ?? undefined,
    })
    await loadEntries()
    const id = data.entry?.id
    if (id) {
      const next = new Set(selected.value)
      next.add(id)
      selected.value = next
    }
  } catch (err: unknown) {
    error.value = String((err as Error)?.message ?? err)
  } finally {
    uploading.value = false
  }
}

function confirm() {
  emit('close')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  void loadEntries()
})

onUnmounted(() => window.removeEventListener('keydown', onKeydown))

watch(
  () => props.projectId,
  () => void loadEntries(),
)
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop knowledge-picker-backdrop" @click.self="emit('close')">
      <div
        class="modal knowledge-picker"
        role="dialog"
        aria-modal="true"
        :aria-label="t('monitor.createTask.knowledgePickerTitle')"
      >
        <div class="modal-head">
          <span>{{ t('monitor.createTask.knowledgePickerTitle') }}</span>
          <button
            type="button"
            class="modal-close"
            :aria-label="t('monitor.createTask.close')"
            @click="emit('close')"
          >
            ✕
          </button>
        </div>

        <div class="modal-body knowledge-picker-body">
          <input
            v-model="query"
            type="search"
            class="cfg-input"
            :placeholder="t('monitor.createTask.knowledgeSearch')"
          />

          <ul class="knowledge-picker-list" :aria-busy="loading">
            <li v-if="loading" class="knowledge-picker-empty">{{ t('monitor.createTask.loading') }}</li>
            <li v-else-if="!filtered.length" class="knowledge-picker-empty">
              {{ t('monitor.createTask.knowledgeEmpty') }}
            </li>
            <li v-for="e in filtered" :key="e.id">
              <label class="knowledge-picker-row">
                <input
                  type="checkbox"
                  :checked="selected.has(e.id)"
                  @change="toggle(e.id)"
                />
                <span class="knowledge-picker-title">{{ e.title || e.id }}</span>
                <code class="knowledge-picker-id">{{ e.id }}</code>
              </label>
            </li>
          </ul>

          <div class="knowledge-picker-upload">
            <label class="cfg-label">{{ t('monitor.createTask.uploadTags') }}</label>
            <input v-model="uploadTags" class="cfg-input" :placeholder="t('monitor.createTask.uploadTagsHint')" />
            <label class="btn-ghost btn-sm knowledge-upload-btn">
              {{ uploading ? t('monitor.createTask.uploading') : t('monitor.createTask.uploadFile') }}
              <input
                type="file"
                accept=".md,.txt,text/markdown,text/plain"
                hidden
                :disabled="uploading"
                @change="onUpload"
              />
            </label>
          </div>

          <p v-if="error" class="knowledge-picker-err">⚠ {{ error }}</p>
        </div>

        <div class="modal-actions knowledge-picker-foot">
          <button type="button" class="btn-ghost" @click="emit('close')">
            {{ t('monitor.createTask.cancel') }}
          </button>
          <button type="button" class="btn-primary" @click="confirm">
            {{ t('monitor.createTask.knowledgeDone', { count: modelValue.length }) }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.knowledge-picker {
  width: min(560px, 94vw);
  max-height: min(640px, 90vh);
  display: flex;
  flex-direction: column;
}

.knowledge-picker-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  flex: 1;
}

.knowledge-picker-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: auto;
  flex: 1;
  min-height: 200px;
  max-height: 320px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel-2, var(--input-surface));
}

.knowledge-picker-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  cursor: pointer;
  font-size: 13px;
}

.knowledge-picker-row:hover {
  background: rgba(var(--accent-rgb), 0.08);
}

.knowledge-picker-title {
  flex: 1;
  min-width: 0;
}

.knowledge-picker-id {
  font-size: 11px;
  opacity: 0.7;
}

.knowledge-picker-empty {
  padding: 14px 10px;
  opacity: 0.55;
  font-size: 13px;
}

.knowledge-picker-upload {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.knowledge-upload-btn {
  cursor: pointer;
  position: relative;
}

.knowledge-picker-err {
  color: var(--danger);
  margin: 0;
  font-size: 12px;
}

.knowledge-picker-foot {
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
</style>
