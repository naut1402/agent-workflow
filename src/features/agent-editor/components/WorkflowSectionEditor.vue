<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { ref, computed, onMounted, watch } from 'vue'
import { parseWorkflowMarkdown, compileWorkflowMarkdown } from '../../../core/lib/workflowSteps'
import { useSortable } from '../../../core/composables/useSortable'
import { slugifySectionKey } from '../../../core/contracts/agentMarkdown.js'
import { fetchPipelineConfig } from '../../pipeline-editor/scripts/pipelineEditorApi'
import { fetchWorkflowStepTemplates, fetchWorkflowStepTemplate, saveWorkflowStepTemplate } from '../scripts/WorkflowSectionEditorApi'
import MarkdownTextEditor from '../../../core/ui/MarkdownTextEditor.vue'

const { t } = useI18nHelpers()
const props = defineProps({
  modelValue: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'message', 'error'])

const tab = ref('direct')
const directText = ref(props.modelValue)
const steps = ref(parseWorkflowMarkdown(props.modelValue))
const pipelineSteps = ref([])
const templates = ref([])
const selectedPipelineStep = ref('')
const selectedTemplate = ref('')
const savingIdx = ref(-1)

const stepsOrder = computed({
  get: () => steps.value,
  set: (v) => {
    steps.value = v
    syncBuilderToMarkdown()
  },
})

const { onDragStart, onDragOver, onDragEnd } = useSortable(stepsOrder)

onMounted(async () => {
  try {
    const data = await fetchPipelineConfig(null)
    pipelineSteps.value = (data.pipeline?.steps || []).map((s) => ({
      id: s.id,
      name: s.name || s.id,
      description: (s.description || '').slice(0, 300),
    }))
  } catch {
    pipelineSteps.value = []
  }
  await loadTemplates()
})

watch(
  () => props.modelValue,
  (v) => {
    if (tab.value === 'direct') directText.value = v
  },
)

async function loadTemplates() {
  try {
    const data = await fetchWorkflowStepTemplates()
    templates.value = data.templates || []
  } catch {
    templates.value = []
  }
}

function switchTab(next) {
  if (next === tab.value) return
  if (next === 'builder') {
    steps.value = parseWorkflowMarkdown(props.modelValue || directText.value)
  } else {
    directText.value = compileWorkflowMarkdown(steps.value)
    emit('update:modelValue', directText.value)
  }
  tab.value = next
}

function syncBuilderToMarkdown() {
  emit('update:modelValue', compileWorkflowMarkdown(steps.value))
}

function onDirectUpdate(value: string) {
  directText.value = value
  emit('update:modelValue', value)
}

function updateStep(index, field, value) {
  const next = [...steps.value]
  next[index] = { ...next[index], [field]: value }
  steps.value = next
  syncBuilderToMarkdown()
}

function addEmptyStep() {
  steps.value = [...steps.value, { title: '', body: '', pipelineStepId: '' }]
  syncBuilderToMarkdown()
}

function addPipelineStep() {
  const id = selectedPipelineStep.value
  if (!id) return
  const ps = pipelineSteps.value.find((s) => s.id === id)
  if (!ps) return
  steps.value = [
    ...steps.value,
    {
      title: ps.name,
      body: ps.description || '',
      pipelineStepId: ps.id,
    },
  ]
  selectedPipelineStep.value = ''
  syncBuilderToMarkdown()
}

async function addFromTemplate() {
  const name = selectedTemplate.value
  if (!name) return
  try {
    const data = await fetchWorkflowStepTemplate(name)
    const t = data.template
    steps.value = [
      ...steps.value,
      {
        title: t.title || name,
        body: t.body || '',
        pipelineStepId: t.pipeline_step_id || '',
      },
    ]
    selectedTemplate.value = ''
    syncBuilderToMarkdown()
  } catch (e) {
    emit('error', String(e.message || e))
  }
}

function removeStep(index) {
  steps.value = steps.value.filter((_, i) => i !== index)
  syncBuilderToMarkdown()
}

async function saveStepTemplate(index) {
  const step = steps.value[index]
  if (!step?.title?.trim() && !step?.body?.trim()) {
    emit('error', t('agentEditor.workflow.emptyStepError'))
    return
  }
  const defaultName = `step-${slugifySectionKey(step.title || `buoc-${index + 1}`)}`
  const name = prompt(t('agentEditor.workflow.promptTemplateName'), defaultName)
  if (!name?.trim()) return

  savingIdx.value = index
  try {
    const result = await saveWorkflowStepTemplate({
      name: name.trim(),
      title: step.title || t('agentEditor.workflow.defaultStepTitle', { n: index + 1 }),
      body: step.body || '',
      pipeline_step_id: step.pipelineStepId || '',
    })
    await loadTemplates()
    emit('message', t('agentEditor.workflow.savedTemplate', { name: result.name }))
  } catch (e) {
    emit('error', String(e.message || e))
  } finally {
    savingIdx.value = -1
  }
}
</script>

<template>
  <div class="workflow-section-editor">
    <div class="workflow-tabs">
      <button
        type="button"
        class="workflow-tab"
        :class="{ active: tab === 'direct' }"
        @click="switchTab('direct')"
      >
        {{ t('agentEditor.workflow.directInput') }}
      </button>
      <button
        type="button"
        class="workflow-tab"
        :class="{ active: tab === 'builder' }"
        @click="switchTab('builder')"
      >
        Builder
      </button>
    </div>

    <div v-if="tab === 'direct'" class="workflow-tab-panel">
      <MarkdownTextEditor
        :model-value="directText"
        height="240px"
        @update:model-value="onDirectUpdate"
      />
    </div>

    <div v-else class="workflow-tab-panel workflow-builder">
      <div class="workflow-builder-toolbar">
        <select v-model="selectedPipelineStep" class="cfg-input cfg-input-sm">
          <option value="">{{ t('agentEditor.workflow.fromPipeline') }}</option>
          <option v-for="ps in pipelineSteps" :key="ps.id" :value="ps.id">
            {{ ps.name }}
          </option>
        </select>
        <button type="button" class="btn-ghost btn-sm" :disabled="!selectedPipelineStep" @click="addPipelineStep">
          {{ t('agentEditor.workflow.add') }}
        </button>
        <select v-model="selectedTemplate" class="cfg-input cfg-input-sm">
          <option value="">{{ t('agentEditor.workflow.fromTemplate') }}</option>
          <option v-for="tpl in templates" :key="tpl.name" :value="tpl.name">
            {{ tpl.name }}
          </option>
        </select>
        <button type="button" class="btn-ghost btn-sm" :disabled="!selectedTemplate" @click="addFromTemplate">
          {{ t('agentEditor.workflow.add') }}
        </button>
        <button type="button" class="btn-ghost btn-sm" @click="addEmptyStep">{{ t('agentEditor.workflow.addEmpty') }}</button>
      </div>

      <p v-if="!steps.length" class="muted workflow-builder-empty">{{ t('agentEditor.workflow.empty') }}</p>

      <div
        v-for="(step, index) in steps"
        :key="index"
        class="workflow-builder-step"
        draggable="true"
        @dragstart="onDragStart(index)"
        @dragover="onDragOver($event, index)"
        @dragend="onDragEnd"
      >
        <div class="workflow-builder-step-head">
          <span class="drag-handle">⋮⋮</span>
          <span class="workflow-step-num">{{ t('agentEditor.workflow.stepNum', { n: index + 1 }) }}</span>
          <span v-if="step.pipelineStepId" class="chip chip-xs">{{ step.pipelineStepId }}</span>
          <div class="section-head-actions">
            <button
              type="button"
              class="btn-ghost btn-sm"
              :disabled="savingIdx === index"
              @click="saveStepTemplate(index)"
            >
              {{ savingIdx === index ? '…' : t('agentEditor.workflow.saveTemplate') }}
            </button>
            <button type="button" class="btn-ghost btn-sm btn-danger" @click="removeStep(index)">✕</button>
          </div>
        </div>
        <input
          class="cfg-input cfg-input-sm"
          :value="step.title"
          :placeholder="t('agentEditor.workflow.titlePlaceholder')"
          @input="updateStep(index, 'title', ($event.target as HTMLInputElement).value)"
        />
        <MarkdownTextEditor
          :model-value="step.body"
          height="160px"
          @update:model-value="updateStep(index, 'body', $event)"
        />
      </div>
    </div>
  </div>
</template>
