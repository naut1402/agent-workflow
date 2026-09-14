<script setup lang="ts">
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'
import { ref, computed, onMounted, watch } from 'vue'
import {
  fetchKnowledgeList,
  fetchKnowledgeEntry,
  saveKnowledgeEntry,
  createKnowledgeEntry,
  deleteKnowledgeEntry,
  fetchKnowledgeCollections,
  deleteKnowledgeCollection,
  fetchKnowledgeBundle,
  type KnowledgeCollectionView,
  type KnowledgeEntryMeta,
  type KnowledgeTagFacetView,
} from '../scripts/KnowledgePanelApi'
import CScreenLayout from '../../../frontend/ui/CScreenLayout.vue'
import CMarkdownView from '../../../frontend/ui/CMarkdownView.vue'
import KnowledgeSideMenu from './KnowledgeSideMenu.vue'
import KnowledgeFormDialog, { type KnowledgeDraft } from './KnowledgeFormDialog.vue'
import KnowledgeUploadDialog from './KnowledgeUploadDialog.vue'
import KnowledgeCollectionDialog from './KnowledgeCollectionDialog.vue'
import KnowledgeTagDialog from './KnowledgeTagDialog.vue'

/**
 * Orchestrator màn knowledge: cột trái là sub-menu, `main` là viewer markdown.
 *
 * `projectId` phải xuống tới mọi lời gọi: nhóm và tag có đường ghi
 * (`renameTag` rewrite front-matter hàng loạt, `deleteCollection`), nên chạy
 * nhầm root không còn là xem sai danh sách mà là hỏng dữ liệu project khác.
 */
const props = defineProps<{
  projectId?: string
  subSidebarCollapsed?: boolean
}>()

const { t } = useI18nHelpers()

const scope = ref('project')
/** Đa chọn: entry phải mang đủ mọi tag đang bật, giống filter phía driver. */
const tagFilter = ref<string[]>([])
const query = ref('')
const entries = ref<KnowledgeEntryMeta[]>([])
const allTags = ref<KnowledgeTagFacetView[]>([])
const collections = ref<KnowledgeCollectionView[]>([])
const collectionsError = ref('')
const activeCollection = ref('')
const loading = ref(false)
const error = ref('')
const message = ref('')

/**
 * Hai state tách hẳn nhau — trước đây bấm một dòng vừa chọn vừa mở dialog:
 * `viewingId` là entry hiển thị ở `main` (icon eye / bấm tên), `editingId` là
 * entry đang mở trong dialog (icon pencil).
 */
const viewingId = ref<string | null>(null)
const viewingEntry = ref<any>(null)
const viewLoading = ref(false)
const editingId = ref<string | null>(null)
const showDialog = ref(false)
const deletingId = ref<string | null>(null)

const showUpload = ref(false)
const showCollectionDialog = ref(false)
const editingCollection = ref<KnowledgeCollectionView | null>(null)
const showTagDialog = ref(false)
const editingTag = ref<KnowledgeTagFacetView | null>(null)

const draft = ref<KnowledgeDraft>({ title: '', scope: 'project', tags: [], content: '' })

const filteredEntries = computed(() => {
  let list = entries.value
  if (tagFilter.value.length) list = list.filter((e) => tagFilter.value.every((tag) => e.tags?.includes(tag)))
  if (query.value.trim()) {
    const q = query.value.trim().toLowerCase()
    list = list.filter(
      (e) =>
        e.title?.toLowerCase().includes(q) ||
        e.id?.toLowerCase().includes(q) ||
        e.tags?.some((tag) => tag.includes(q)),
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
  } catch (e: any) {
    error.value = String(e.message || e)
  } finally {
    loading.value = false
  }
}

/**
 * DB hỏng không được làm chết cả panel — entry đọc từ file nên vẫn xem/sửa được.
 *
 * Nhưng cũng không được hiện thành "chưa có nhóm nào": người dùng tạo nhóm
 * mới ngay lúc đó là ghi đè mất dữ liệu cũ. Lỗi hiện ra và khoá đường ghi.
 */
async function loadCollections() {
  collectionsError.value = ''
  try {
    const data = await fetchKnowledgeCollections(props.projectId)
    collections.value = data.collections || []
  } catch (e: any) {
    collections.value = []
    collectionsError.value = String(e.message || e)
  }
}

function toggleTagFilter(tag: string) {
  const i = tagFilter.value.indexOf(tag)
  if (i >= 0) tagFilter.value.splice(i, 1)
  else tagFilter.value.push(tag)
}

function selectCollection(id: string) {
  activeCollection.value = activeCollection.value === id ? '' : id
}

// ── viewer

async function openViewer(id: string) {
  viewingId.value = id
  viewLoading.value = true
  message.value = ''
  try {
    const data = await fetchKnowledgeEntry(id, props.projectId)
    viewingEntry.value = data.entry
  } catch (e: any) {
    // Entry có thể vừa bị xoá ngoài dashboard — trả `main` về empty state thay
    // vì kẹt ở spinner; lỗi hiện bên cột trái.
    error.value = String(e.message || e)
    viewingId.value = null
    viewingEntry.value = null
  } finally {
    viewLoading.value = false
  }
}

// ── editor

async function openEditor(id: string) {
  message.value = ''
  try {
    const data = await fetchKnowledgeEntry(id, props.projectId)
    const e = data.entry
    editingId.value = id
    draft.value = { title: e.title, scope: e.scope, tags: [...(e.tags || [])], content: e.content || '' }
    showDialog.value = true
  } catch (e: any) {
    error.value = String(e.message || e)
  }
}

function newEntry() {
  editingId.value = null
  draft.value = { title: '', scope: scope.value, tags: [], content: '' }
  message.value = ''
  showDialog.value = true
}

function closeDialog() {
  showDialog.value = false
}

/** Không gửi `slug`: driver nội suy từ title và tự chống trùng. */
async function save() {
  error.value = ''
  message.value = ''
  try {
    const payload = {
      id: editingId.value || undefined,
      title: draft.value.title,
      scope: draft.value.scope,
      tags: draft.value.tags,
      content: draft.value.content,
    }
    const data = editingId.value
      ? await saveKnowledgeEntry(editingId.value, payload, props.projectId)
      : await createKnowledgeEntry(payload, props.projectId)
    editingId.value = data.entry.id
    message.value = t('knowledge.messages.saved', { id: data.entry.id })
    await loadList()
    // Đang xem chính entry vừa sửa thì viewer phải theo kịp, không hiện bản cũ.
    if (viewingId.value === data.entry.id) await openViewer(data.entry.id)
  } catch (e: any) {
    error.value = String(e.message || e)
  }
}

async function removeEntry(id: string) {
  if (deletingId.value) return // chặn double-click
  if (!confirm(t('knowledge.messages.confirmDelete', { id }))) return
  deletingId.value = id
  error.value = ''
  try {
    await deleteKnowledgeEntry(id, props.projectId)
    message.value = t('knowledge.messages.deleted')
    // Xoá entry đang xem → `main` thu về 0, cột trái chiếm full width.
    if (viewingId.value === id) {
      viewingId.value = null
      viewingEntry.value = null
    }
    if (editingId.value === id) showDialog.value = false
    await loadList()
  } catch (e: any) {
    error.value = String(e.message || e)
  } finally {
    deletingId.value = null
  }
}

// ── download

/** Blob → `<a download>` → revoke, đúng mẫu đã có ở `PipelineEditor`. */
function saveBlob(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function stamp() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * `JSON.stringify` cho mọi giá trị: YAML nhận double-quoted scalar, nên một
 * title chứa `:`, xuống dòng hay chính dòng `---` không cắt đôi được khối
 * front-matter của file tải về.
 */
const yamlStr = (v: unknown) => JSON.stringify(String(v ?? ''))

function toMarkdownSection(item: any): string {
  // Item vượt trần 1MB của bundle trả `{ id, error }` — ghi thành chú thích
  // trong file gộp, không bỏ im lặng.
  if (item.error) return `<!-- ${item.id}: ${item.error} -->`
  const tags = (item.tags || []).map(yamlStr).join(', ')
  return [
    '---',
    `title: ${yamlStr(item.title)}`,
    `id: ${yamlStr(item.id)}`,
    `tags: [${tags}]`,
    '---',
    '',
    item.content ?? '',
  ].join('\n')
}

/** Gộp entry đang lọc thành một file. Chia lô 50 — đúng trần `MAX_BUNDLE_IDS`. */
async function downloadFiltered() {
  const ids = filteredEntries.value.map((e) => e.id)
  if (!ids.length) return
  error.value = ''
  try {
    const items: any[] = []
    for (let i = 0; i < ids.length; i += 50) {
      const { bundle } = await fetchKnowledgeBundle(ids.slice(i, i + 50), props.projectId)
      items.push(...bundle)
    }
    saveBlob(items.map(toMarkdownSection).join('\n\n'), `knowledge-${scope.value}-${stamp()}.md`)
    const failed = items.filter((i) => i.error).length
    message.value = failed ? t('knowledge.messages.downloadPartial', { count: failed }) : ''
  } catch (e: any) {
    error.value = String(e.message || e)
  }
}

async function downloadEntry(id: string) {
  error.value = ''
  try {
    const { entry } = await fetchKnowledgeEntry(id, props.projectId)
    saveBlob(toMarkdownSection(entry), `${entry.slug || entry.id.replace('/', '-')}.md`)
  } catch (e: any) {
    error.value = String(e.message || e)
  }
}

// ── collection

function newCollection() {
  editingCollection.value = null
  showCollectionDialog.value = true
}

function editCollection(collection: KnowledgeCollectionView) {
  editingCollection.value = collection
  showCollectionDialog.value = true
}

async function onCollectionSaved(id: string, created: boolean) {
  showCollectionDialog.value = false
  message.value = created
    ? t('knowledge.collections.created', { id })
    : t('knowledge.collections.updated', { id })
  await loadCollections()
  if (activeCollection.value) await loadList()
}

/** Xoá nhóm — tài liệu bên trong không bị xoá; câu xác nhận phải nói rõ. */
async function removeCollection(id: string) {
  if (!confirm(t('knowledge.collections.confirmDelete', { id }))) return
  error.value = ''
  try {
    await deleteKnowledgeCollection(id, props.projectId)
    if (activeCollection.value === id) activeCollection.value = ''
    message.value = t('knowledge.collections.deleted', { id })
    await loadCollections()
    await loadList()
  } catch (e: any) {
    error.value = String(e.message || e)
  }
}

// ── tag

function newTag() {
  editingTag.value = null
  showTagDialog.value = true
}

function editTag(tag: KnowledgeTagFacetView) {
  editingTag.value = tag
  showTagDialog.value = true
}

async function onTagSaved(tag: string, created: boolean) {
  showTagDialog.value = false
  message.value = created
    ? t('knowledge.tags.created', { tag })
    : t('knowledge.tags.updated', { tag })
  await loadList()
}

/** Đổi tên tag rewrite front-matter hàng loạt → nạp lại cả entry lẫn nhóm. */
async function onTagRenamed(count: number, metaError: string) {
  showTagDialog.value = false
  const from = editingTag.value?.tag
  if (from) tagFilter.value = tagFilter.value.filter((tag) => tag !== from)
  message.value = metaError
    ? t('knowledge.tags.renamedNoMeta', { count, error: metaError })
    : t('knowledge.tags.renamed', { count })
  await loadList()
  await loadCollections()
  if (viewingId.value) await openViewer(viewingId.value)
}

watch([scope, activeCollection], () => loadList())
// Đổi project là đổi cả cây entry lẫn cây nhóm — reset lựa chọn rồi nạp lại cả hai.
watch(
  () => props.projectId,
  async () => {
    viewingId.value = null
    viewingEntry.value = null
    activeCollection.value = ''
    tagFilter.value = []
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
  <!-- Class `.knowledge-panel` ở ROOT chứ 🚫 không trên `main`: `hideMain` thu
       `main` về 0 khi chưa chọn entry, spec e2e chờ nó visible sẽ đỏ ngay lúc
       mở màn. Đây đúng cách `AgentEditor` giữ neo `.agent-editor`. -->
  <CScreenLayout
    class="knowledge-panel knowledge-layout"
    :sub-sidebar-collapsed="subSidebarCollapsed"
    :hide-main="!viewingId"
  >
    <template #left>
      <div class="knowledge-left">
        <template v-if="!subSidebarCollapsed">
          <KnowledgeSideMenu
            v-model:scope="scope"
            v-model:query="query"
            :entries="filteredEntries"
            :loading="loading"
            :collections="collections"
            :collections-error="collectionsError"
            :active-collection="activeCollection"
            :tags="allTags"
            :tag-filter="tagFilter"
            :viewing-id="viewingId"
            :busy-id="deletingId"
            @upload="showUpload = true"
            @download="downloadFiltered"
            @new="newEntry"
            @view="openViewer"
            @edit="openEditor"
            @download-entry="downloadEntry"
            @delete="removeEntry"
            @select-collection="selectCollection"
            @new-collection="newCollection"
            @edit-collection="editCollection"
            @delete-collection="removeCollection"
            @toggle-tag="toggleTagFilter"
            @new-tag="newTag"
            @edit-tag="editTag"
          />
          <p v-if="error" class="err knowledge-msg">{{ error }}</p>
          <p v-if="message" class="ok-msg knowledge-msg">{{ message }}</p>
        </template>
      </div>
    </template>

    <template #main>
      <div class="knowledge-main">
        <!-- Sub-menu thu về rail thì cột trái rộng 0, nên chỗ duy nhất còn thấy
             được là main. Hai trạng thái loại trừ nhau nên thông báo không bao
             giờ render hai lần. -->
        <template v-if="subSidebarCollapsed">
          <p v-if="error" class="err knowledge-msg">{{ error }}</p>
          <p v-if="message" class="ok-msg knowledge-msg">{{ message }}</p>
        </template>
        <!-- 🚫 `with-frontmatter`: `driver.read()` đã bóc front-matter sẵn, nên
             chỉ còn phần text — đúng yêu cầu "không hiển thị siêu dữ liệu". -->
        <!-- `doc-key` là id chứ không phải title: hai entry trùng title là ca
             thật (driver phải thêm hậu tố slug chính vì thế). -->
        <CMarkdownView
          v-if="viewingId && viewingEntry && !viewLoading"
          :title="viewingEntry.title"
          :doc-key="viewingId"
          :content="viewingEntry.content || ''"
        />
        <p v-else-if="viewLoading" class="muted knowledge-main-empty">{{ t('knowledge.viewer.loading') }}</p>
        <div v-else class="muted knowledge-main-empty">{{ t('knowledge.viewer.empty') }}</div>
      </div>
    </template>
  </CScreenLayout>

  <!-- 4 dialog là modal ngang hàng, đứng ngoài CScreenLayout. -->
  <KnowledgeFormDialog
    v-if="showDialog"
    v-model:draft="draft"
    :selected-id="editingId"
    :all-tags="allTags"
    :message="message"
    :error="error"
    @close="closeDialog"
    @save="save"
  />
  <KnowledgeUploadDialog
    v-if="showUpload"
    :project-id="projectId"
    @close="showUpload = false"
    @uploaded="
      (id) => {
        showUpload = false
        message = t('knowledge.messages.uploaded', { id })
        loadList()
        openViewer(id)
      }
    "
  />
  <KnowledgeCollectionDialog
    v-if="showCollectionDialog"
    :collection="editingCollection"
    :tags="allTags"
    :project-id="projectId"
    @close="showCollectionDialog = false"
    @saved="onCollectionSaved"
  />
  <KnowledgeTagDialog
    v-if="showTagDialog"
    :tag="editingTag"
    :project-id="projectId"
    @close="showTagDialog = false"
    @saved="onTagSaved"
    @renamed="onTagRenamed"
  />
</template>

<style scoped lang="scss">
.knowledge-left {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
// Thu về 0 chứ không 48px mặc định: dải đó không chứa nút nào, giữ lại là một
// cột xám rỗng. Selector đích nằm TRÊN slot "left" nên override neo vào gốc.
.knowledge-layout :deep(.c-screen-layout__body--left-collapsed) {
  grid-template-columns: 0 1fr;
}
.knowledge-msg {
  margin: 0;
  padding: 8px 10px;
  font-size: 12px;
  flex-shrink: 0;
}
.knowledge-main {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
// Root của component con nhận luôn scope id của cha, nên không cần `:deep`.
.knowledge-main > .c-md-view {
  flex: 1;
  min-height: 0;
  height: auto;
}
.knowledge-main-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: 0;
  padding: 24px;
  text-align: center;
  font-size: 13px;
}
</style>
