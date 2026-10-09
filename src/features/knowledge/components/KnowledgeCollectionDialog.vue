<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'
import { useApiAction } from '../../../frontend/composables/useApiAction'
import CDialog from '../../../frontend/ui/CDialog.vue'
import {
  createKnowledgeCollection,
  fetchKnowledgeList,
  saveKnowledgeCollection,
  type KnowledgeCollectionView,
  type KnowledgeEntryMeta,
  type KnowledgeTagFacetView,
} from '../scripts/KnowledgePanelApi'

const props = defineProps<{
  collection: KnowledgeCollectionView | null
  tags: KnowledgeTagFacetView[]
  projectId?: string
}>()

const emit = defineEmits<{ close: []; saved: [id: string, created: boolean] }>()

const { t } = useI18nHelpers()

const name = ref(props.collection?.name ?? '')
const description = ref(props.collection?.description ?? '')
const scope = ref(props.collection?.scope ?? 'project')
const selectedTags = ref<string[]>([...(props.collection?.tags ?? [])])
const selectedIds = ref<string[]>([...(props.collection?.entry_ids ?? [])])

const entryQuery = ref('')
const { pending: saving, run: runSave } = useApiAction()
const error = ref('')

const isEdit = computed(() => !!props.collection)

const allEntries = ref<KnowledgeEntryMeta[]>([])

onMounted(async () => {
  try {
    const data = await fetchKnowledgeList({ scope: 'all', projectId: props.projectId })
    allEntries.value = data.entries || []
  } catch (e: any) {
    error.value = String(e.message || e)
  }
})

const filteredEntries = computed(() => {
  const q = entryQuery.value.trim().toLowerCase()
  if (!q) return allEntries.value
  return allEntries.value.filter(
    (e) => e.title?.toLowerCase().includes(q) || e.id?.toLowerCase().includes(q),
  )
})

function toggleId(id: string) {
  const i = selectedIds.value.indexOf(id)
  if (i >= 0) selectedIds.value.splice(i, 1)
  else selectedIds.value.push(id)
}

function toggleTag(tag: string) {
  const i = selectedTags.value.indexOf(tag)
  if (i >= 0) selectedTags.value.splice(i, 1)
  else selectedTags.value.push(tag)
}

function tagStyle(tag: KnowledgeTagFacetView) {
  return { '--tag-c': `var(--tag-${tag.color})`, '--tag-c-rgb': `var(--tag-${tag.color}-rgb)` }
}

async function save() {
  if (!name.value.trim()) return
  await runSave(async () => {
    error.value = ''
    try {
      const payload = {
        name: name.value.trim(),
        description: description.value,
        scope: scope.value,
        tags: selectedTags.value,
        entryIds: selectedIds.value,
      }
      const data = props.collection
        ? await saveKnowledgeCollection(props.collection.id, payload, props.projectId)
        : await createKnowledgeCollection(payload, props.projectId)
      emit('saved', data.collection.id, !props.collection)
    } catch (e: any) {
      error.value = String(e.message || e)
    }
  })
}
</script>

<template>
  <CDialog
    class="knowledge-collection-dialog"
    :title="isEdit
      ? t('knowledge.collections.dialog.editTitle', { id: collection?.id })
      : t('knowledge.collections.dialog.createTitle')"
    :loading="saving"
    width="min(640px, calc(100vw - 32px))"
    @close="emit('close')"
  >
    <div class="knowledge-collection-body">
      <label class="cfg-label">
        {{ t('knowledge.collections.dialog.name') }}
        <input v-model="name" class="cfg-input" />
      </label>
      <label class="cfg-label">
        {{ t('knowledge.collections.dialog.description') }}
        <input v-model="description" class="cfg-input" />
      </label>
      <label class="cfg-label">
        {{ t('knowledge.collections.scope') }}
        <select v-model="scope" class="cfg-input" :disabled="isEdit">
          <option value="project">project</option>
          <option value="global">global</option>
        </select>
      </label>

      <div class="cfg-label">
        <span>{{ t('knowledge.collections.dialog.byEntries') }}</span>
        <input
          v-model="entryQuery"
          class="cfg-input cfg-input-sm"
          :placeholder="t('knowledge.collections.dialog.entrySearchPlaceholder')"
        />
        <ul class="knowledge-pick-list">
          <li v-if="!filteredEntries.length" class="muted knowledge-pick-msg">
            {{ t('knowledge.collections.dialog.entriesEmpty') }}
          </li>
          <li v-for="e in filteredEntries" :key="e.id" class="knowledge-pick-item">
            <label>
              <input
                type="checkbox"
                :checked="selectedIds.includes(e.id)"
                @change="toggleId(e.id)"
              />
              <span class="knowledge-pick-title">{{ e.title }}</span>
              <span class="muted">{{ e.id }}</span>
            </label>
          </li>
        </ul>
        <p class="muted knowledge-pick-count">
          {{ t('knowledge.collections.dialog.selectedCount', { count: selectedIds.length }) }}
        </p>
      </div>

      <div class="cfg-label">
        <span>{{ t('knowledge.collections.dialog.byTags') }}</span>
        <div class="tag-row">
          <span v-if="!tags.length" class="muted">{{ t('knowledge.collections.dialog.tagsEmpty') }}</span>
          <button
            v-for="tag in tags"
            :key="tag.tag"
            type="button"
            class="chip chip-tag knowledge-tag-toggle"
            :class="{ active: selectedTags.includes(tag.tag) }"
            :style="tagStyle(tag)"
            @click="toggleTag(tag.tag)"
          >{{ tag.tag }}</button>
        </div>
      </div>

      <p v-if="error" class="err">{{ error }}</p>
    </div>

    <template #footer>
      <div class="modal-foot">
        <button type="button" class="btn-primary" :disabled="saving || !name.trim()" @click="save">
          {{ t('knowledge.actions.save') }}
        </button>
        <button type="button" class="btn-ghost" @click="emit('close')">{{ t('knowledge.form.cancel') }}</button>
      </div>
    </template>
  </CDialog>
</template>

<style scoped lang="scss">
.knowledge-collection-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.knowledge-pick-list {
  list-style: none;
  margin: 4px 0 0;
  padding: 4px;
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.knowledge-pick-msg { padding: 6px; font-size: 12px; }
.knowledge-pick-item > label {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}
.knowledge-pick-item > label:hover { background: var(--panel-2); }
.knowledge-pick-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.knowledge-pick-count { margin: 4px 0 0; font-size: 11px; }
.knowledge-tag-toggle { cursor: pointer; }
.knowledge-tag-toggle.active { outline: 1px solid var(--accent); }
</style>
