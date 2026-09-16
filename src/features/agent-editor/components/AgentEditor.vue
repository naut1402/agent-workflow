<script setup lang="ts">
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'
import { ref, computed, onMounted } from 'vue'
import {
  fetchCustomAgents,
  fetchCustomAgent,
  deleteCustomAgent,
  type AgentMeta,
} from '../scripts/agentEditorApi'
import { draftFromAgentMarkdown } from '../business/agentMarkdown.js'
import { fetchCatalog } from '../../pipeline-editor/scripts/pipelineEditorApi'
import CScreenLayout from '../../../frontend/ui/CScreenLayout.vue'
import AgentSideMenu from './AgentSideMenu.vue'
import CMarkdownView from '../../../frontend/ui/CMarkdownView.vue'
import AgentFormDialog from './AgentFormDialog.vue'

const props = defineProps<{ projectId?: string | null; subSidebarCollapsed?: boolean }>()

const { t } = useI18nHelpers()

const agents = ref<AgentMeta[]>([])
const catalog = ref({ skills: [], agents: [] })
const error = ref('')
const message = ref('')

// Agent đang xem ở main.
const viewing = ref<AgentMeta | null>(null)
const viewContent = ref('')
const viewLoading = ref(false)
const deletingKey = ref<string | null>(null)

const showDialog = ref(false)
const editingAgent = ref<AgentMeta | null>(null)
const initialDraft = ref<Record<string, unknown> | null>(null)

const keyOf = (a: AgentMeta) => `${a.scope}:${a.name}`
const selectedKey = computed(() => (viewing.value ? keyOf(viewing.value) : null))

async function loadList() {
  try {
    const data = await fetchCustomAgents(props.projectId ?? undefined)
    agents.value = data.agents || []
  } catch (e: any) {
    error.value = String(e.message || e)
  }
}

async function loadCatalog() {
  try {
    catalog.value = await fetchCatalog()
  } catch {
    catalog.value = { skills: [], agents: [] }
  }
}

onMounted(async () => {
  await Promise.all([loadList(), loadCatalog()])
})

async function openViewer(agent: AgentMeta) {
  viewing.value = agent
  viewLoading.value = true
  error.value = ''
  message.value = ''
  try {
    const data = await fetchCustomAgent(agent.name, props.projectId ?? undefined, agent.scope)
    viewContent.value = data.content ?? ''
  } catch (e: any) {
    // Agent có thể vừa bị xoá ngoài dashboard — trả main về empty state thay vì
    // kẹt ở spinner, lỗi hiện bên cột trái.
    error.value = String(e.message || e)
    viewing.value = null
    viewContent.value = ''
  } finally {
    viewLoading.value = false
  }
}

function openEditor(agent: AgentMeta) {
  editingAgent.value = agent
  initialDraft.value = null
  showDialog.value = true
}

function newAgent() {
  editingAgent.value = null
  initialDraft.value = null
  showDialog.value = true
}

async function removeAgent(agent: AgentMeta) {
  if (deletingKey.value) return // chặn double-click
  if (!confirm(t('agentEditor.messages.confirmDelete', { name: agent.name }))) return
  deletingKey.value = keyOf(agent)
  error.value = ''
  try {
    await deleteCustomAgent(agent.name, props.projectId ?? undefined, agent.scope)
    if (viewing.value && keyOf(viewing.value) === keyOf(agent)) {
      viewing.value = null
      viewContent.value = ''
    }
    await Promise.all([loadList(), loadCatalog()])
    message.value = t('agentEditor.messages.deleted')
  } catch (e: any) {
    error.value = String(e.message || e)
  } finally {
    deletingKey.value = null
  }
}

async function handleDownloadAgent(agent: AgentMeta) {
  try {
    const data = await fetchCustomAgent(agent.name, props.projectId ?? undefined, agent.scope)
    const blob = new Blob([data.content ?? ''], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${agent.name}.md`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch (e: any) {
    error.value = String(e.message || e)
  }
}

async function handleDuplicateAgent(agent: AgentMeta) {
  try {
    const data = await fetchCustomAgent(agent.name, props.projectId ?? undefined, agent.scope)
    const draft = draftFromAgentMarkdown(data.content ?? '', agent)
    applyDraft(draft)
  } catch (e: any) {
    error.value = String(e.message || e)
  }
}

async function handleUploadAgentFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const text = await file.text()
    const draft = draftFromAgentMarkdown(text, {})
    applyDraft(draft)
  } catch (e: any) {
    error.value = String(e.message || e)
  }
}

function applyDraft(draft: Record<string, unknown>) {
  editingAgent.value = null
  initialDraft.value = draft
  showDialog.value = true
}

function closeDialog() {
  showDialog.value = false
}

/**
 * `savedName` là tên SAU khi lưu (đã qua sanitize của backend) — đổi field
 * `name` rồi lưu là đổi luôn file đích, nên bám theo `viewing` cũ sẽ hiện lại
 * bản chưa đổi. Ưu tiên đúng scope, vì dialog cho phép đổi cả scope.
 */
async function onSaved(savedName: string) {
  await Promise.all([loadList(), loadCatalog()])
  const current = viewing.value
  if (!current) return
  const byName = agents.value.filter((a) => a.name === savedName)
  const next = byName.find((a) => a.scope === current.scope) ?? byName[0]
  await openViewer(next ?? current)
}
</script>

<template>
  <CScreenLayout
    class="agent-editor-layout"
    :sub-sidebar-collapsed="subSidebarCollapsed"
    :hide-main="!viewing"
  >
    <template #left>
      <!-- class `.agent-editor` giữ nguyên: đây là neo ổn định của 2 spec e2e. -->
      <div class="agent-editor">
        <template v-if="!subSidebarCollapsed">
          <AgentSideMenu
            :agents="agents"
            :selected-key="selectedKey"
            :busy-key="deletingKey"
            @new="newAgent"
            @download="handleDownloadAgent"
            @duplicate="handleDuplicateAgent"
            @upload-file="handleUploadAgentFile"
            @view="openViewer"
            @edit="openEditor"
            @delete="removeAgent"
          />
          <p v-if="error" class="err agent-editor-msg">{{ error }}</p>
          <p v-if="message" class="ok-msg agent-editor-msg">{{ message }}</p>
        </template>
      </div>
    </template>

    <template #main>
      <div class="agent-main">
        <!-- Sub-menu thu lại thì cột trái rộng 0 (override bên dưới), nên chỗ
             duy nhất còn thấy được là main. Hai trạng thái loại trừ nhau nên
             thông báo không bao giờ render hai lần. -->
        <template v-if="subSidebarCollapsed">
          <p v-if="error" class="err agent-editor-msg">{{ error }}</p>
          <p v-if="message" class="ok-msg agent-editor-msg">{{ message }}</p>
        </template>
        <!-- `with-frontmatter`: agent đọc nguyên file `.md`, khối `---` đầu file
             đúng là metadata nên tách ra thành block riêng. -->
        <CMarkdownView
          v-if="viewing && !viewLoading"
          :title="viewing.name"
          :doc-key="selectedKey ?? ''"
          :content="viewContent"
          with-frontmatter
        />
        <p v-else-if="viewLoading" class="muted agent-main-empty">{{ t('agentEditor.viewer.loading') }}</p>
        <div v-else class="muted agent-main-empty">{{ t('agentEditor.viewer.empty') }}</div>
      </div>
    </template>
  </CScreenLayout>

  <!-- Dialog là modal ngang hàng, đứng ngoài CScreenLayout. -->
  <AgentFormDialog
    v-if="showDialog"
    :agent="editingAgent"
    :initial-draft="initialDraft"
    :project-id="projectId"
    :catalog="catalog"
    @close="closeDialog"
    @saved="onSaved"
  />
</template>

<style scoped lang="scss">
.agent-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
// Thu về 0 chứ không 48px mặc định: dải đó không chứa nút nào, giữ lại là một
// cột xám rỗng — cùng cách MonitorLayout xử lý. Selector đích nằm TRÊN slot
// "left", nên override phải neo vào chính gốc CScreenLayout.
.agent-editor-layout :deep(.c-screen-layout__body--left-collapsed) {
  grid-template-columns: 0 1fr;
}
.agent-editor-msg {
  margin: 0;
  padding: 8px 10px;
  font-size: 12px;
  flex-shrink: 0;
}
.agent-main {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
// Root của component con nhận luôn scope id của cha, nên không cần `:deep`.
.agent-main > .c-md-view {
  flex: 1;
  min-height: 0;
  height: auto;
}
.agent-main-empty {
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
