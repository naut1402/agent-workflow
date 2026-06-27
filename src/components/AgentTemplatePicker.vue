<script setup>
import { ref, onMounted } from 'vue'
import {
  fetchAgentTemplates,
  fetchAgentTemplate,
  fetchCatalog,
  fetchCatalogAgent,
  importAgentTemplateUrl,
  uploadAgentTemplate,
  deleteAgentTemplate,
} from '../api.js'
import { draftFromCatalogAgent } from '../lib/agentMarkdown.js'

const emit = defineEmits(['apply-draft', 'close'])

const templates = ref([])
const catalog = ref({ agents: [] })
const templateName = ref('default-agent')
const urlInput = ref('')
const urlName = ref('')
const error = ref('')
const fileInput = ref(null)

onMounted(async () => {
  try {
    const [t, c] = await Promise.all([fetchAgentTemplates(), fetchCatalog()])
    templates.value = t.templates || []
    catalog.value = c
  } catch (e) {
    error.value = String(e.message || e)
  }
})

async function loadTemplate(name) {
  error.value = ''
  try {
    const data = await fetchAgentTemplate(name)
    emit('apply-draft', { ...data.draft, name: `${name}-agent` })
    emit('close')
  } catch (e) {
    error.value = String(e.message || e)
  }
}

async function copyCatalogAgent(agent) {
  error.value = ''
  try {
    const data = await fetchCatalogAgent(agent.id)
    emit('apply-draft', { ...data.draft, name: `${agent.name}-copy` })
    emit('close')
  } catch (e) {
    emit('apply-draft', draftFromCatalogAgent(agent))
    emit('close')
    error.value = `Copy fallback (không đọc được file gốc): ${e.message || e}`
  }
}

async function importUrl() {
  error.value = ''
  try {
    const data = await importAgentTemplateUrl(urlInput.value, urlName.value || undefined)
    if (data.draft) emit('apply-draft', { ...data.draft, name: data.name })
    else await loadTemplate(data.name)
  } catch (e) {
    error.value = String(e.message || e)
  }
}

async function onFileChange(event) {
  const file = event.target.files?.[0]
  if (!file) return
  error.value = ''
  try {
    const data = await uploadAgentTemplate(file)
    await loadTemplate(data.name)
  } catch (e) {
    error.value = String(e.message || e)
  }
}

async function removeTemplate(name) {
  if (!confirm(`Xóa template "${name}"?`)) return
  await deleteAgentTemplate(name)
  templates.value = (await fetchAgentTemplates()).templates || []
}
</script>

<template>
  <div class="agent-template-picker">
    <h3 class="picker-title">Template & Copy</h3>
    <p v-if="error" class="err">{{ error }}</p>

    <section class="picker-section">
      <h4>Từ template</h4>
      <select v-model="templateName" class="cfg-input">
        <option v-for="t in templates" :key="t.name" :value="t.name">{{ t.name }}</option>
      </select>
      <button type="button" class="btn-primary btn-sm" @click="loadTemplate(templateName)">Dùng template</button>
      <button type="button" class="btn-ghost btn-sm" @click="removeTemplate(templateName)">Xóa template</button>
    </section>

    <section class="picker-section">
      <h4>Sao chép từ catalog</h4>
      <div class="catalog-copy-list">
        <button
          v-for="a in (catalog.agents || []).slice(0, 12)"
          :key="a.id"
          type="button"
          class="btn-ghost btn-sm catalog-copy-btn"
          @click="copyCatalogAgent(a)"
        >
          {{ a.name }}
        </button>
      </div>
    </section>

    <section class="picker-section">
      <h4>Upload file</h4>
      <input ref="fileInput" type="file" accept=".md,.yaml,.yml" @change="onFileChange" />
    </section>

    <section class="picker-section">
      <h4>Từ URL (https)</h4>
      <input v-model="urlInput" class="cfg-input" placeholder="https://..." />
      <input v-model="urlName" class="cfg-input cfg-input-sm" placeholder="Tên template (optional)" />
      <button type="button" class="btn-primary btn-sm" @click="importUrl">Import</button>
    </section>

    <button type="button" class="btn-ghost" @click="emit('close')">Đóng</button>
  </div>
</template>
