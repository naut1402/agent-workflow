<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { ref, computed, onMounted, watch } from 'vue'
import { fetchKnowledgeList, fetchKnowledgeEntry, saveKnowledgeEntry, createKnowledgeEntry, deleteKnowledgeEntry, uploadKnowledgeFile, fetchKnowledgeTags } from '../scripts/KnowledgePanelApi'
import MarkdownTextEditor from '../../../core/ui/MarkdownTextEditor.vue'

const { t } = useI18nHelpers()

const scope = ref('project')
const tagFilter = ref('')
const query = ref('')
const entries = ref([])
const allTags = ref([])
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
  if (scope.value) list = list.filter((e) => e.scope === scope.value)
  if (tagFilter.value) list = list.filter((e) => e.tags?.includes(tagFilter.value))
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

async function loadList() {
  loading.value = true
  error.value = ''
  try {
    const [listData, tagData] = await Promise.all([
      fetchKnowledgeList({ scope: scope.value || undefined }),
      fetchKnowledgeTags(),
    ])
    entries.value = listData.entries || []
    allTags.value = tagData.tags || []
  } catch (e) {
    error.value = String(e.message || e)
  } finally {
    loading.value = false
  }
}

async function selectEntry(id) {
  selectedId.value = id
  message.value = ''
  try {
    const data = await fetchKnowledgeEntry(id)
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
      ? await saveKnowledgeEntry(selectedId.value, payload)
      : await createKnowledgeEntry(payload)
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
    await deleteKnowledgeEntry(selectedId.value)
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
    const data = await uploadKnowledgeFile(file, { scope: uploadScope.value, tags })
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

watch(scope, () => loadList())
onMounted(loadList)
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
          </div>
          <input v-model="query" class="cfg-input cfg-input-sm" :placeholder="t('knowledge.filters.searchPlaceholder')" />
          <select v-model="tagFilter" class="cfg-input cfg-input-sm">
            <option value="">{{ t('knowledge.filters.allTags') }}</option>
            <option v-for="t in allTags" :key="t.tag" :value="t.tag">
              {{ t.tag }} ({{ t.count }})
            </option>
          </select>
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
          <select v-model="draft.scope" class="cfg-input" :disabled="!!selectedId">
            <option value="project">project</option>
            <option value="system">system</option>
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
        <label class="cfg-label knowledge-content-label">
          {{ t('knowledge.fields.content') }}
          <MarkdownTextEditor v-model="draft.content" height="400px" />
        </label>
        <div class="knowledge-editor-actions">
          <button class="btn-primary btn-sm" @click="save">{{ t('knowledge.actions.save') }}</button>
          <button v-if="selectedId" class="btn-danger btn-sm" @click="remove">{{ t('knowledge.actions.delete') }}</button>
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
