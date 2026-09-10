<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { ref, computed, onMounted, watch } from 'vue'
import { fetchKnowledgeList, fetchKnowledgeEntry, saveKnowledgeEntry, createKnowledgeEntry, deleteKnowledgeEntry, uploadKnowledgeFile, fetchKnowledgeCollections, createKnowledgeCollection, saveKnowledgeCollection, deleteKnowledgeCollection, renameKnowledgeTag } from '../scripts/KnowledgePanelApi'
import MarkdownTextEditor from '../../../core/ui/MarkdownTextEditor.vue'
import CSelect from '../../../core/ui/CSelect.vue'

/**
 * `projectId` phải xuống tới **mọi** lời gọi: nhóm và tag có đường **ghi**
 * (`renameTag` rewrite front-matter hàng loạt, `deleteCollection`), nên chạy
 * nhầm root không còn là xem sai danh sách mà là hỏng dữ liệu project khác.
 */
const props = defineProps<{
  projectId?: string
}>()

const { t } = useI18nHelpers()

const scope = ref('project')
/** Đa chọn: entry phải mang **đủ** mọi tag đang bật, giống filter phía driver. */
const tagFilter = ref([])
const query = ref('')
const entries = ref([])
const allTags = ref([])
const collections = ref([])
const collectionsError = ref('')
const activeCollection = ref('')
const selectedId = ref(null)
const loading = ref(false)
const error = ref('')
const message = ref('')

const draft = ref({
  title: '',
  slug: '',
  scope: 'project',
  tags: [],
  content: '',
})

const tagInput = ref('')
const uploadTags = ref('')
const uploadScope = ref('project')
const uploading = ref(false)
const showUpload = ref(false)

const filteredEntries = computed(() => {
  let list = entries.value
  if (tagFilter.value.length) list = list.filter((e) => tagFilter.value.every((tag) => e.tags?.includes(tag)))
  if (query.value.trim()) {
    const q = query.value.trim().toLowerCase()
    list = list.filter(
      (e) =>
        e.title?.toLowerCase().includes(q) ||
        e.id?.toLowerCase().includes(q) ||
        e.tags?.some((t) => t.includes(q)),
    )
  }
  return list
})

/**
 * Một request cho cả entry lẫn facet tag (`include=tags`) — trước đây là hai,
 * và cái thứ hai (`/tags`) walk lại toàn bộ store.
 */
async function loadList() {
  loading.value = true
  error.value = ''
  try {
    const data = await fetchKnowledgeList({
      scope: scope.value || undefined,
      collection: activeCollection.value || undefined,
      include: 'tags',
      projectId: props.projectId,
    })
    entries.value = data.entries || []
    allTags.value = data.tags || []
  } catch (e) {
    error.value = String(e.message || e)
  } finally {
    loading.value = false
  }
}

/**
 * Sidecar hỏng không được làm chết cả panel — entry vẫn xem được.
 *
 * Nhưng cũng 🚫 không được hiện thành "chưa có nhóm nào": người dùng tạo nhóm
 * mới ngay lúc đó là ghi đè mất dữ liệu cũ. Lỗi hiện ra và khoá đường tạo.
 */
async function loadCollections() {
  collectionsError.value = ''
  try {
    const data = await fetchKnowledgeCollections(props.projectId)
    collections.value = data.collections || []
  } catch (e) {
    collections.value = []
    collectionsError.value = String(e.message || e)
  }
}

function toggleTagFilter(tag) {
  const i = tagFilter.value.indexOf(tag)
  if (i >= 0) tagFilter.value.splice(i, 1)
  else tagFilter.value.push(tag)
}

function selectCollection(id) {
  activeCollection.value = activeCollection.value === id ? '' : id
}

async function selectEntry(id) {
  selectedId.value = id
  message.value = ''
  try {
    const data = await fetchKnowledgeEntry(id, props.projectId)
    const e = data.entry
    draft.value = {
      title: e.title,
      slug: e.slug,
      scope: e.scope,
      tags: [...(e.tags || [])],
      content: e.content || '',
    }
  } catch (e) {
    error.value = String(e.message || e)
  }
}

function newEntry() {
  selectedId.value = null
  draft.value = {
    title: '',
    slug: '',
    scope: scope.value,
    tags: [],
    content: '',
  }
  message.value = ''
}

function addTag() {
  const t = tagInput.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
  if (t && !draft.value.tags.includes(t)) draft.value.tags.push(t)
  tagInput.value = ''
}

function removeTag(i) {
  draft.value.tags.splice(i, 1)
}

// ── collection ─────────────────────────────────────────────────────────────

const newCollectionName = ref('')
const newCollectionScope = ref('project')
/** Nhóm chỉ có sidecar riêng ở hai store: `system` dùng chung file với `project`. */
const collectionScopeOptions = [
  { value: 'project', label: 'project' },
  { value: 'global', label: 'global' },
]

async function addCollection() {
  const name = newCollectionName.value.trim()
  if (!name) return
  error.value = ''
  try {
    const data = await createKnowledgeCollection({ name, scope: newCollectionScope.value }, props.projectId)
    newCollectionName.value = ''
    message.value = t('knowledge.collections.created', { id: data.collection.id })
    await loadCollections()
  } catch (e) {
    error.value = String(e.message || e)
  }
}

/** Xoá nhóm — tài liệu bên trong **không** bị xoá, nhãn nút phải nói rõ. */
async function removeCollection(id) {
  if (!confirm(t('knowledge.collections.confirmDelete', { id }))) return
  error.value = ''
  try {
    await deleteKnowledgeCollection(id, props.projectId)
    if (activeCollection.value === id) activeCollection.value = ''
    message.value = t('knowledge.collections.deleted', { id })
    await loadCollections()
    await loadList()
  } catch (e) {
    error.value = String(e.message || e)
  }
}

/** Gán entry đang mở vào nhóm — `entry_ids` là cách gom thủ công, cạnh gom theo tag. */
async function addSelectedToCollection(collection) {
  if (!selectedId.value) return
  error.value = ''
  try {
    const entryIds = [...new Set([...(collection.entry_ids || []), selectedId.value])]
    await saveKnowledgeCollection(
      collection.id,
      {
        name: collection.name,
        description: collection.description,
        tags: collection.tags || [],
        entryIds,
      },
      props.projectId,
    )
    message.value = t('knowledge.collections.entryAdded', { id: collection.id })
    await loadCollections()
    if (activeCollection.value) await loadList()
  } catch (e) {
    error.value = String(e.message || e)
  }
}

// ── tag admin ──────────────────────────────────────────────────────────────

const renameFrom = ref('')
const renameTo = ref('')
const renameFromOptions = computed(() => [
  { value: '', label: t('knowledge.tagAdmin.from') },
  ...allTags.value.map((tag) => ({ value: tag.tag, label: tag.tag })),
])

/** `to` rỗng = xoá tag khỏi mọi entry; `to` trùng tag có sẵn = merge hai tag. */
async function applyRenameTag() {
  if (!renameFrom.value) return
  error.value = ''
  try {
    const data = await renameKnowledgeTag(renameFrom.value, renameTo.value.trim() || undefined, props.projectId)
    message.value = t('knowledge.tagAdmin.done', { count: data.renamed })
    tagFilter.value = tagFilter.value.filter((tag) => tag !== renameFrom.value)
    renameFrom.value = ''
    renameTo.value = ''
    await loadList()
    await loadCollections()
  } catch (e) {
    error.value = String(e.message || e)
  }
}

async function save() {
  error.value = ''
  message.value = ''
  try {
    const payload = {
      id: selectedId.value || undefined,
      title: draft.value.title,
      slug: draft.value.slug || draft.value.title,
      scope: draft.value.scope,
      tags: draft.value.tags,
      content: draft.value.content,
    }
    const data = selectedId.value
      ? await saveKnowledgeEntry(selectedId.value, payload, props.projectId)
      : await createKnowledgeEntry(payload, props.projectId)
    selectedId.value = data.entry.id
    message.value = t('knowledge.messages.saved', { id: data.entry.id })
    await loadList()
  } catch (e) {
    error.value = String(e.message || e)
  }
}

async function remove() {
  if (!selectedId.value) return
  if (!confirm(t('knowledge.messages.confirmDelete', { id: selectedId.value }))) return
  try {
    await deleteKnowledgeEntry(selectedId.value, props.projectId)
    message.value = t('knowledge.messages.deleted')
    newEntry()
    await loadList()
  } catch (e) {
    error.value = String(e.message || e)
  }
}

async function onFileUpload(event) {
  const file = event.target.files?.[0]
  if (!file) return
  uploading.value = true
  error.value = ''
  try {
    const tags = uploadTags.value.split(/[,;]+/).map((t) => t.trim()).filter(Boolean)
    const data = await uploadKnowledgeFile(file, { scope: uploadScope.value, tags, projectId: props.projectId })
    message.value = t('knowledge.messages.uploaded', { id: data.entry.id })
    showUpload.value = false
    uploadTags.value = ''
    await loadList()
    await selectEntry(data.entry.id)
  } catch (e) {
    error.value = String(e.message || e)
  } finally {
    uploading.value = false
    event.target.value = ''
  }
}

watch([scope, activeCollection], () => loadList())
// Đổi project là đổi cả cây entry lẫn cây nhóm — nạp lại cả hai.
watch(
  () => props.projectId,
  async () => {
    activeCollection.value = ''
    await loadList()
    await loadCollections()
  },
)
onMounted(async () => {
  await loadList()
  await loadCollections()
})
</script>

<template>
  <div class="knowledge-panel">
    <header class="knowledge-head">
      <h2>{{ t('knowledge.title') }}</h2>
      <div class="knowledge-head-actions">
        <button class="btn-ghost btn-sm" @click="showUpload = !showUpload">{{ t('knowledge.actions.upload') }}</button>
        <button class="btn-primary btn-sm" @click="newEntry">{{ t('knowledge.actions.create') }}</button>
      </div>
    </header>

    <div v-if="showUpload" class="knowledge-upload-box">
      <label class="cfg-label">
        {{ t('knowledge.upload.scope') }}
        <select v-model="uploadScope" class="cfg-input">
          <option value="project">project</option>
          <option value="system">system</option>
          <option value="global">global</option>
        </select>
      </label>
      <label class="cfg-label">
        {{ t('knowledge.upload.tags') }}
        <input v-model="uploadTags" class="cfg-input" placeholder="pipeline, vue" />
      </label>
      <label class="cfg-label">
        {{ t('knowledge.upload.file') }}
        <input type="file" accept=".md,.txt,text/plain,text/markdown" :disabled="uploading" @change="onFileUpload" />
      </label>
    </div>

    <div class="knowledge-layout">
      <aside class="knowledge-list-pane">
        <!-- Cây collection nằm TRÊN cụm tab scope: một nhóm gom được entry của
             nhiều scope, nên nó không phải là nhánh con của scope nào. -->
        <div class="knowledge-collections">
          <div class="knowledge-collections-head">
            <span>{{ t('knowledge.collections.title') }}</span>
            <button
              v-if="activeCollection"
              type="button"
              class="btn-ghost btn-sm"
              @click="activeCollection = ''"
            >{{ t('knowledge.collections.clear') }}</button>
          </div>
          <p v-if="collectionsError" class="knowledge-collections-error">
            {{ t('knowledge.collections.loadFailed', { error: collectionsError }) }}
          </p>
          <ul class="knowledge-collection-list">
            <li v-if="!collections.length && !collectionsError" class="muted">{{ t('knowledge.collections.empty') }}</li>
            <li
              v-for="c in collections"
              :key="c.id"
              class="knowledge-collection-item"
              :class="{ active: activeCollection === c.id }"
            >
              <button type="button" class="knowledge-collection-name" @click="selectCollection(c.id)">
                {{ c.name }} <span class="muted">({{ c.entryCount }} · {{ c.scope }})</span>
              </button>
              <button
                v-if="selectedId"
                type="button"
                class="btn-ghost btn-sm"
                :title="t('knowledge.collections.addEntry')"
                @click="addSelectedToCollection(c)"
              >+</button>
              <button
                type="button"
                class="btn-ghost btn-sm"
                :title="t('knowledge.collections.delete')"
                @click="removeCollection(c.id)"
              >✕</button>
            </li>
          </ul>
          <div class="knowledge-collection-new">
            <input
              v-model="newCollectionName"
              class="cfg-input cfg-input-sm"
              :placeholder="t('knowledge.collections.namePlaceholder')"
              :disabled="!!collectionsError"
              @keydown.enter.prevent="addCollection"
            />
            <CSelect
              v-model="newCollectionScope"
              :options="collectionScopeOptions"
              :disabled="!!collectionsError"
              :aria-label="t('knowledge.collections.scope')"
              class="cfg-input-sm"
            />
            <button type="button" class="btn-ghost btn-sm" :disabled="!!collectionsError" @click="addCollection">
              {{ t('knowledge.collections.create') }}
            </button>
          </div>
        </div>

        <div class="knowledge-filters">
          <div class="knowledge-scope-tabs">
            <button
              class="knowledge-scope-tab"
              :class="{ active: scope === 'project' }"
              @click="scope = 'project'"
            >{{ t('knowledge.scopeTabs.project') }}</button>
            <button
              class="knowledge-scope-tab"
              :class="{ active: scope === 'system' }"
              @click="scope = 'system'"
            >{{ t('knowledge.scopeTabs.system') }}</button>
            <button
              class="knowledge-scope-tab"
              :class="{ active: scope === 'global' }"
              @click="scope = 'global'"
            >{{ t('knowledge.scopeTabs.global') }}</button>
          </div>
          <input v-model="query" class="cfg-input cfg-input-sm" :placeholder="t('knowledge.filters.searchPlaceholder')" />
          <div class="tag-row knowledge-tag-filter">
            <span v-if="!allTags.length" class="muted">{{ t('knowledge.filters.allTags') }}</span>
            <button
              v-for="tag in allTags"
              :key="tag.tag"
              type="button"
              class="chip chip-skill"
              :class="{ active: tagFilter.includes(tag.tag) }"
              @click="toggleTagFilter(tag.tag)"
            >{{ tag.tag }} ({{ tag.count }})</button>
          </div>
          <div class="knowledge-tag-admin">
            <CSelect
              v-model="renameFrom"
              :options="renameFromOptions"
              :aria-label="t('knowledge.tagAdmin.from')"
              class="cfg-input-sm"
            />
            <input
              v-model="renameTo"
              class="cfg-input cfg-input-sm"
              :placeholder="t('knowledge.tagAdmin.toPlaceholder')"
              @keydown.enter.prevent="applyRenameTag"
            />
            <button type="button" class="btn-ghost btn-sm" :disabled="!renameFrom" @click="applyRenameTag">
              {{ t('knowledge.tagAdmin.apply') }}
            </button>
          </div>
        </div>

        <ul class="knowledge-list">
          <li v-if="loading" class="muted">{{ t('knowledge.list.loading') }}</li>
          <li v-else-if="!filteredEntries.length" class="muted">{{ t('knowledge.list.empty') }}</li>
          <li
            v-for="e in filteredEntries"
            :key="e.id"
            class="knowledge-list-item"
            :class="{ active: selectedId === e.id }"
            @click="selectEntry(e.id)"
          >
            <div class="knowledge-list-title">{{ e.title }}</div>
            <div class="knowledge-list-meta">{{ e.id }}</div>
            <div v-if="e.tags?.length" class="tag-row">
              <span v-for="t in e.tags" :key="t" class="chip chip-skill">{{ t }}</span>
            </div>
          </li>
        </ul>
      </aside>

      <section class="knowledge-editor-pane" v-if="draft">
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
              v-for="(t, i) in draft.tags"
              :key="t"
              class="chip chip-rm"
              @click="removeTag(i)"
            >{{ t }} ✕</span>
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
              <option v-for="t in allTags" :key="t.tag" :value="t.tag" />
            </datalist>
            <button class="btn-ghost btn-sm" type="button" @click="addTag">+</button>
          </div>
        </label>
        <div class="cfg-label knowledge-content-label">
          <span>{{ t('knowledge.fields.content') }}</span>
          <MarkdownTextEditor v-model="draft.content" height="400px" />
        </div>
        <div class="knowledge-editor-actions">
          <button type="button" class="btn-primary btn-sm" @click="save">{{ t('knowledge.actions.save') }}</button>
          <button v-if="selectedId" type="button" class="btn-danger btn-sm" @click="remove">{{ t('knowledge.actions.delete') }}</button>
          <span v-if="message" class="save-msg">{{ message }}</span>
          <span v-if="error" class="err">{{ error }}</span>
        </div>
      </section>
      <section v-else class="knowledge-editor-pane empty">
        <p class="muted">{{ t('knowledge.editor.empty') }}</p>
      </section>
    </div>
  </div>
</template>

<style scoped lang="scss">
.knowledge-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 16px;
  gap: 12px;
}
.knowledge-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.knowledge-head h2 { margin: 0; font-size: 16px; }
.knowledge-head-actions { display: flex; gap: 8px; }
.knowledge-upload-box {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  background: var(--panel);
  display: grid;
  gap: 8px;
  max-width: 480px;
}
.knowledge-layout {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 12px;
  flex: 1;
  min-height: 0;
}
.knowledge-list-pane {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.knowledge-filters {
  padding: 10px;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.knowledge-collections {
  padding: 10px;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.knowledge-collections-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 600;
}
.knowledge-collections-error {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--danger, #c0392b);
}
.knowledge-collection-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 140px;
  overflow-y: auto;
}
.knowledge-collection-item {
  display: flex;
  align-items: center;
  gap: 4px;
  border-radius: 6px;
  padding: 2px 4px;
}
.knowledge-collection-item.active { background: var(--accent-dim); }
.knowledge-collection-name {
  flex: 1;
  min-width: 0;
  text-align: left;
  background: none;
  border: 0;
  color: inherit;
  cursor: pointer;
  font-size: 12px;
  padding: 4px 2px;
}
.knowledge-collection-new { display: flex; gap: 4px; }
.knowledge-tag-filter { flex-wrap: wrap; gap: 4px; }
.knowledge-tag-filter .chip { cursor: pointer; border: 1px solid transparent; }
.knowledge-tag-filter .chip.active { border-color: var(--accent); }
.knowledge-tag-admin { display: flex; gap: 4px; }
.knowledge-scope-tabs { display: flex; gap: 6px; }
.knowledge-scope-tab {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel-2);
  cursor: pointer;
  font-size: 12px;
}
.knowledge-scope-tab.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.knowledge-list {
  list-style: none;
  margin: 0;
  padding: 8px;
  overflow-y: auto;
  flex: 1;
}
.knowledge-list-item {
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 4px;
}
.knowledge-list-item:hover { background: var(--panel-2); }
.knowledge-list-item.active { background: var(--accent-dim); }
.knowledge-list-title { font-size: 13px; font-weight: 600; }
.knowledge-list-meta { font-size: 11px; color: var(--muted); }
.knowledge-editor-pane {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  padding: 12px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
/* flex:1 + min-height:<content> lets the label shrink below Toast UI height,
   so the editor overflows and covers the Save row (esp. visible in light theme). */
.knowledge-content-label {
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
}
.knowledge-editor-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  flex-shrink: 0;
  position: relative;
  z-index: 1;
}
</style>
