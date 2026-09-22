<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'
import {
  createKnowledgeCollection,
  fetchKnowledgeList,
  saveKnowledgeCollection,
  type KnowledgeCollectionView,
  type KnowledgeEntryMeta,
  type KnowledgeTagFacetView,
} from '../scripts/KnowledgePanelApi'

/**
 * Tạo / sửa collection. Thành viên gom bằng hai cơ chế cộng dồn trong cùng
 * một form: chọn tài liệu thủ công (`entryIds`) và chọn tag (`tags`).
 *
 * Backend resolve hợp của hai tập lúc đọc (`resolveCollectionEntries`), nên ở
 * đây không phải tính trước danh sách thành viên.
 */
const props = defineProps<{
  /** `null` = tạo mới. */
  collection: KnowledgeCollectionView | null
  tags: KnowledgeTagFacetView[]
  projectId?: string
}>()

const emit = defineEmits<{ close: []; saved: [id: string, created: boolean] }>()

const { t } = useI18nHelpers()

const name = ref(props.collection?.name ?? '')
const description = ref(props.collection?.description ?? '')
// Scope quyết định store chứa nhóm → khoá khi sửa, đúng như backend từ chối đổi.
const scope = ref(props.collection?.scope ?? 'project')
const selectedTags = ref<string[]>([...(props.collection?.tags ?? [])])
const selectedIds = ref<string[]>([...(props.collection?.entry_ids ?? [])])

const entryQuery = ref('')
const saving = ref(false)
const error = ref('')

const isEdit = computed(() => !!props.collection)

/**
 * Nguồn chọn thủ công là entry của mọi scope, không phải tab scope đang mở:
 * một nhóm gom được entry của nhiều scope, nên lọc theo tab đang mở sẽ giấu mất
 * đúng những entry người dùng định thêm.
 */
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
  if (!name.value.trim() || saving.value) return
  saving.value = true
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
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal knowledge-collection-dialog" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h3>
          {{ isEdit
            ? t('knowledge.collections.dialog.editTitle', { id: collection?.id })
            : t('knowledge.collections.dialog.createTitle') }}
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

      <div class="modal-body knowledge-collection-body">
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
          <!-- Khoá khi sửa: đổi scope là đổi store, tức đổi con trỏ của mọi nơi
               đang tham chiếu nhóm — backend cũng từ chối. -->
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

      <div class="modal-foot">
        <button type="button" class="btn-primary" :disabled="saving || !name.trim()" @click="save">
          {{ t('knowledge.actions.save') }}
        </button>
        <button type="button" class="btn-ghost" @click="emit('close')">{{ t('knowledge.form.cancel') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.knowledge-collection-dialog {
  width: min(640px, calc(100vw - 32px));
}
.knowledge-collection-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: min(76vh, 760px);
  overflow-y: auto;
}
/* Danh sách chọn có trần riêng: nó là lá cuộn, không được đẩy `.modal-foot` ra
   ngoài viền dialog (docs/convention/ui-overflow.md). */
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
