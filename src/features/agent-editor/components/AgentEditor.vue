<script setup lang="ts">
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'
import { ref, onMounted } from 'vue'
import { fetchCustomAgents, type AgentScope } from '../scripts/agentEditorApi'
import { fetchCatalog } from '../../pipeline-editor/scripts/pipelineEditorApi'
import CScreenLayout from '../../../frontend/ui/CScreenLayout.vue'
import AgentFormDialog from './AgentFormDialog.vue'

const props = defineProps<{ projectId?: string | null }>()

const { t } = useI18nHelpers()
const agents = ref<{ name: string; scope: AgentScope }[]>([])
const catalog = ref({ skills: [], agents: [] })
const error = ref('')

const showDialog = ref(false)
const editingAgent = ref<{ name: string; scope: AgentScope } | null>(null)

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

function newAgent() {
  editingAgent.value = null
  showDialog.value = true
}

function selectAgent(agent: { name: string; scope: AgentScope }) {
  editingAgent.value = agent
  showDialog.value = true
}

function closeDialog() {
  showDialog.value = false
}

async function onSaved() {
  await Promise.all([loadList(), loadCatalog()])
}

async function onDeleted() {
  await Promise.all([loadList(), loadCatalog()])
}
</script>

<template>
  <CScreenLayout>
    <template #main>
      <div class="agent-editor">
        <header class="agent-editor-head">
          <h2>{{ t('agentEditor.list.title') }}</h2>
          <button type="button" class="btn-primary btn-sm" @click="newAgent">{{ t('agentEditor.list.newButton') }}</button>
        </header>

        <p v-if="error" class="err">{{ error }}</p>

        <ul class="agent-list">
          <li
            v-for="a in agents"
            :key="`${a.scope}:${a.name}`"
            class="agent-list-item"
            @click="selectAgent(a)"
          >
            <span class="agent-list-name">{{ a.name }}</span>
            <span class="chip chip-xs">{{ a.scope === 'global' ? t('agentEditor.fields.scopeGlobal') : t('agentEditor.fields.scopeProject') }}</span>
          </li>
          <li v-if="!agents.length" class="muted agent-list-empty">{{ t('agentEditor.list.empty') }}</li>
        </ul>

        <AgentFormDialog
          v-if="showDialog"
          :agent="editingAgent"
          :project-id="projectId"
          :catalog="catalog"
          @close="closeDialog"
          @saved="onSaved"
          @deleted="onDeleted"
        />
      </div>
    </template>
  </CScreenLayout>
</template>

<style scoped lang="scss">
.agent-editor {
  padding: 16px;
  max-width: 720px;
}
.agent-editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.agent-editor-head h2 { font-size: 16px; margin: 0; }
.agent-list { list-style: none; margin: 0; padding: 0; }
.agent-list-item {
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  margin-bottom: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 13px;
}
.agent-list-item:hover { background: var(--panel-2); }
.agent-list-empty { padding: 8px; border: none; cursor: default; }
</style>
