<script setup>
import { ref, onMounted } from 'vue'
import {
  fetchCustomAgents,
  fetchCustomAgent,
  saveCustomAgent,
  deleteCustomAgent,
  exportCustomAgent,
  fetchCatalog,
} from '../api.js'
import { emptyDraft } from '../lib/agentMarkdown.js'
import AgentSectionEditor from './AgentSectionEditor.vue'
import AgentTemplatePicker from './AgentTemplatePicker.vue'
import AgentNlWizard from './AgentNlWizard.vue'

const agents = ref([])
const catalog = ref({ skills: [], agents: [] })
const draft = ref(emptyDraft())
const selectedName = ref('')
const saving = ref(false)
const message = ref('')
const error = ref('')
const showTemplates = ref(false)
const showNl = ref(false)

async function loadList() {
  try {
    const data = await fetchCustomAgents()
    agents.value = data.agents || []
  } catch (e) {
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
  selectedName.value = ''
  draft.value = emptyDraft({ name: 'new-agent' })
  message.value = ''
}

async function selectAgent(name) {
  try {
    const data = await fetchCustomAgent(name)
    selectedName.value = name
    draft.value = { ...data.draft, name: data.name }
    message.value = ''
  } catch (e) {
    error.value = String(e.message || e)
  }
}

async function save() {
  saving.value = true
  error.value = ''
  message.value = ''
  try {
    const result = await saveCustomAgent(draft.value)
    selectedName.value = result.name
    message.value = `Đã lưu ${result.name}`
    await loadList()
    await loadCatalog()
  } catch (e) {
    error.value = String(e.message || e)
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!selectedName.value) return
  if (!confirm(`Xóa agent "${selectedName.value}"?`)) return
  try {
    await deleteCustomAgent(selectedName.value)
    message.value = 'Đã xóa'
    newAgent()
    await loadList()
    await loadCatalog()
  } catch (e) {
    error.value = String(e.message || e)
  }
}

async function doExport(overwrite = false) {
  if (!selectedName.value) {
    error.value = 'Lưu agent trước khi export'
    return
  }
  try {
    const result = await exportCustomAgent(selectedName.value, overwrite)
    message.value = `Exported → ${result.path}`
  } catch (e) {
    const msg = String(e.message || e)
    if (msg.includes('file exists') && confirm('File đã tồn tại. Ghi đè?')) {
      await doExport(true)
    } else {
      error.value = msg
    }
  }
}

function applyDraft(newDraft) {
  draft.value = { ...emptyDraft(), ...newDraft }
  selectedName.value = ''
}
</script>

<template>
  <div class="agent-editor">
    <aside class="agent-list-panel">
      <div class="agent-list-head">
        <h2>Custom Agents</h2>
        <button type="button" class="btn-primary btn-sm" @click="newAgent">+ New</button>
      </div>
      <ul class="agent-list">
        <li
          v-for="a in agents"
          :key="a.name"
          class="agent-list-item"
          :class="{ active: selectedName === a.name }"
          @click="selectAgent(a.name)"
        >
          <span class="agent-list-name">{{ a.name }}</span>
          <span v-if="a.editable" class="chip chip-xs">dashboard</span>
        </li>
        <li v-if="!agents.length" class="muted agent-list-empty">Chưa có agent tùy chỉnh</li>
      </ul>
    </aside>

    <div class="agent-form-panel">
      <div class="agent-toolbar">
        <button type="button" class="btn-ghost btn-sm" @click="showTemplates = true">Template / Copy</button>
        <button type="button" class="btn-ghost btn-sm" @click="showNl = true">Build NL</button>
        <button type="button" class="btn-ghost btn-sm" :disabled="!selectedName" @click="doExport(false)">Export .claude/agents</button>
        <button type="button" class="btn-primary btn-sm" :disabled="saving" @click="save">Lưu</button>
        <button type="button" class="btn-ghost btn-sm btn-danger" :disabled="!selectedName" @click="remove">Xóa</button>
      </div>

      <p v-if="message" class="ok-msg">{{ message }}</p>
      <p v-if="error" class="err">{{ error }}</p>

      <div v-if="showTemplates" class="agent-modal">
        <AgentTemplatePicker @apply-draft="applyDraft" @close="showTemplates = false" />
      </div>
      <div v-if="showNl" class="agent-modal">
        <AgentNlWizard @apply-draft="applyDraft" @close="showNl = false" />
      </div>

      <div class="agent-basic-fields">
        <label class="cfg-label">
          Name
          <input v-model="draft.name" class="cfg-input" placeholder="agent-name" />
        </label>
        <label class="cfg-label">
          Description
          <input v-model="draft.description" class="cfg-input" placeholder="Mô tả ngắn" />
        </label>
        <label class="cfg-label">
          Model khuyến nghị
          <input v-model="draft.model" class="cfg-input" placeholder="claude-sonnet-4-6" />
        </label>
      </div>

      <AgentSectionEditor
        :draft="draft"
        :catalog="catalog"
        @update:draft="draft = $event"
        @message="message = $event; error = ''"
        @error="error = $event; message = ''"
      />
    </div>
  </div>
</template>
