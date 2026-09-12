<script setup lang="ts">
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'
import { onMounted, ref } from 'vue'
import {
  fetchCustomAgent,
  saveCustomAgent,
  deleteCustomAgent,
  exportCustomAgent,
  type AgentScope,
} from '../scripts/agentEditorApi'
import { emptyDraft } from '../business/agentDraft.js'
import AgentSectionEditor from './AgentSectionEditor.vue'
import AgentTemplatePicker from './AgentTemplatePicker.vue'
import AgentNlWizard from './AgentNlWizard.vue'

const props = defineProps<{
  /** Agent đang sửa — null = tạo mới. */
  agent: { name: string; scope: AgentScope } | null
  projectId?: string | null
  catalog: { skills: unknown[]; agents: unknown[] }
}>()

const emit = defineEmits<{ close: []; saved: []; deleted: [] }>()

const { t } = useI18nHelpers()

const draft = ref(emptyDraft())
const scope = ref<AgentScope>('project')
const selectedName = ref('')
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const error = ref('')
const showTemplates = ref(false)
const showNl = ref(false)

onMounted(async () => {
  if (!props.agent) {
    draft.value = emptyDraft({ name: 'new-agent' })
    scope.value = 'project'
    selectedName.value = ''
    return
  }
  loading.value = true
  try {
    const data = await fetchCustomAgent(props.agent.name, props.projectId ?? undefined, props.agent.scope)
    scope.value = props.agent.scope
    selectedName.value = props.agent.name
    draft.value = { ...data.draft, name: data.name }
  } catch (e: any) {
    error.value = String(e.message || e)
  } finally {
    loading.value = false
  }
})

async function save() {
  saving.value = true
  error.value = ''
  message.value = ''
  try {
    const result = await saveCustomAgent(draft.value, props.projectId ?? undefined, scope.value)
    selectedName.value = result.name
    message.value = t('agentEditor.messages.saved', { name: result.name })
    emit('saved')
  } catch (e: any) {
    error.value = String(e.message || e)
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!selectedName.value) return
  if (!confirm(t('agentEditor.messages.confirmDelete', { name: selectedName.value }))) return
  try {
    await deleteCustomAgent(selectedName.value, props.projectId ?? undefined, scope.value)
    emit('deleted')
    emit('close')
  } catch (e: any) {
    error.value = String(e.message || e)
  }
}

async function doExport(overwrite = false) {
  if (!selectedName.value) {
    error.value = t('agentEditor.messages.saveBeforeExport')
    return
  }
  try {
    const result = await exportCustomAgent(selectedName.value, overwrite, props.projectId ?? undefined, scope.value)
    message.value = `Exported → ${result.path}`
  } catch (e: any) {
    const msg = String(e.message || e)
    if (msg.includes('file exists') && confirm(t('agentEditor.messages.confirmOverwrite'))) {
      await doExport(true)
    } else {
      error.value = msg
    }
  }
}

function applyDraft(newDraft: Record<string, unknown>) {
  draft.value = { ...emptyDraft(), ...newDraft }
  selectedName.value = ''
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal agent-form-dialog" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h3>{{ selectedName ? t('agentEditor.form.editTitle', { name: selectedName }) : t('agentEditor.form.createTitle') }}</h3>
        <button
          type="button"
          class="modal-close"
          :title="t('agentEditor.form.close')"
          :aria-label="t('agentEditor.form.close')"
          @click="emit('close')"
        >
          ✕
        </button>
      </div>

      <div class="modal-body agent-form-body">
        <div class="agent-toolbar">
          <button type="button" class="btn-ghost btn-sm" @click="showTemplates = true">{{ t('agentEditor.actions.templateCopy') }}</button>
          <button type="button" class="btn-ghost btn-sm" @click="showNl = true">{{ t('agentEditor.actions.buildNl') }}</button>
          <button type="button" class="btn-ghost btn-sm" :disabled="!selectedName" @click="doExport(false)">{{ t('agentEditor.actions.export') }}</button>
        </div>

        <p v-if="message" class="ok-msg">{{ message }}</p>
        <p v-if="error" class="err">{{ error }}</p>

        <div v-if="showTemplates" class="agent-modal">
          <AgentTemplatePicker @apply-draft="applyDraft" @close="showTemplates = false" />
        </div>
        <div v-if="showNl" class="agent-modal">
          <AgentNlWizard :project-id="projectId" @apply-draft="applyDraft" @close="showNl = false" />
        </div>

        <div class="agent-basic-fields">
          <label class="cfg-label">
            {{ t('agentEditor.fields.name') }}
            <input v-model="draft.name" class="cfg-input" placeholder="agent-name" />
          </label>
          <label class="cfg-label">
            {{ t('agentEditor.fields.description') }}
            <input v-model="draft.description" class="cfg-input" :placeholder="t('agentEditor.fields.descriptionPlaceholder')" />
          </label>
          <label class="cfg-label">
            {{ t('agentEditor.fields.recommendedModel') }}
            <input v-model="draft.model" class="cfg-input" placeholder="claude-sonnet-4-6" />
          </label>
          <label class="cfg-label">
            {{ t('agentEditor.fields.scope') }}
            <select v-model="scope" class="cfg-input">
              <option value="project">{{ t('agentEditor.fields.scopeProject') }}</option>
              <option value="global">{{ t('agentEditor.fields.scopeGlobal') }}</option>
            </select>
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

      <div class="modal-foot">
        <button type="button" class="btn-ghost btn-danger" :disabled="!selectedName" @click="remove">
          {{ t('agentEditor.actions.delete') }}
        </button>
        <button type="button" class="btn-ghost" @click="emit('close')">{{ t('agentEditor.form.cancel') }}</button>
        <button type="button" class="btn-primary" :disabled="saving" @click="save">{{ t('agentEditor.actions.save') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.agent-form-dialog {
  width: min(720px, calc(100vw - 32px));
}
.agent-form-body {
  max-height: min(76vh, 760px);
  overflow-y: auto;
}
.agent-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.agent-basic-fields {
  display: grid;
  gap: 10px;
  margin-bottom: 16px;
}
.agent-modal {
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px;
  margin-bottom: 14px;
}
</style>
