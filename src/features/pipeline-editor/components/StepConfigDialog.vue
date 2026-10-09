<script setup lang="ts">
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'
import { computed, ref, watch } from 'vue'
import CDialog from '../../../frontend/ui/CDialog.vue'
import CSelect from '../../../frontend/ui/CSelect.vue'
import type { CSelectOption } from '../../../frontend/ui/CSelect.vue'
import KnowledgePickerDialog from '../../../frontend/ui/KnowledgePickerDialog.vue'
import { buildStepConfigDraft, buildStepUpdateFromDraft } from '../lib/stepConfigDraft'

const props = defineProps({
  stepId: { type: String, default: null },
  step: { type: Object as () => any, default: null },
  catalog: { type: Object as () => any, required: true },
  projectId: { type: String, default: null },
  /** Option model dựng từ `GET /api/runners` — `value` là runner id. */
  runnerOptions: { type: Array as () => CSelectOption[], default: () => [] },
})

const emit = defineEmits(['update', 'close'])

const { t } = useI18nHelpers()

const showKnowledgePicker = ref(false)

const draft = ref(null)

watch(
  () => props.step,
  (s) => { draft.value = buildStepConfigDraft(s) },
  { immediate: true },
)

// xem docs/architecture/code/pipeline-editor.md §4
const showModelSelect = computed(() => props.runnerOptions.length > 1)

const modelOptions = computed<CSelectOption[]>(() => {
  const opts: CSelectOption[] = [
    { value: '', label: t('pipelineEditor.stepConfig.modelDefault') },
    ...props.runnerOptions,
  ]
  const pinned = draft.value?.runner_id
  if (pinned && !opts.some((o) => o.value === pinned)) {
    opts.push({ value: pinned, label: t('pipelineEditor.stepConfig.modelUnknown', { id: pinned }) })
  }
  return opts
})

const hitlModeOptions = computed<CSelectOption[]>(() => [
  { value: 'none', label: t('pipelineEditor.stepConfig.hitlNone') },
  { value: 'auto', label: t('pipelineEditor.stepConfig.hitlAuto') },
  { value: 'manual', label: t('pipelineEditor.stepConfig.hitlManual') },
])

const producesInput = ref('')

function addProduces() {
  const v = producesInput.value.trim()
  if (v && draft.value && !draft.value.produces.includes(v)) {
    draft.value.produces.push(v)
  }
  producesInput.value = ''
}

function removeProduces(i) {
  draft.value.produces.splice(i, 1)
}

const knowledgeInputs = computed({
  get: () => draft.value?.knowledge_inputs ?? [],
  set: (ids: string[]) => {
    if (draft.value) draft.value.knowledge_inputs = ids
  },
})

function removeKnowledgeInput(i) {
  draft.value.knowledge_inputs.splice(i, 1)
}

function apply() {
  if (!draft.value) return
  emit('update', props.stepId, buildStepUpdateFromDraft(draft.value, props.stepId))
}
</script>

<template>
  <CDialog
    v-if="draft"
    class="step-config-dialog"
    :title="t('pipelineEditor.stepConfig.title')"
    :close-on-escape="!showKnowledgePicker"
    width="min(520px, 94vw)"
    @close="emit('close')"
  >
    <div class="step-config-dialog-body">
      <label class="cfg-label">
        {{ t('pipelineEditor.stepConfig.name') }}
        <input
          v-model="draft.name"
          class="cfg-input"
          :placeholder="t('pipelineEditor.stepConfig.namePlaceholder')"
        />
      </label>

      <label class="cfg-label">
        {{ t('pipelineEditor.stepConfig.agent') }}
        <input
          v-model="draft.agent"
          class="cfg-input"
          list="catalog-agents-list"
          :placeholder="t('pipelineEditor.stepConfig.agentPlaceholder')"
        />
        <datalist id="catalog-agents-list">
          <option v-for="a in (catalog.agents || [])" :key="a.id" :value="a.id">{{ a.name }}</option>
        </datalist>
      </label>

      <div v-if="showModelSelect" class="cfg-label">
        {{ t('pipelineEditor.stepConfig.model') }}
        <CSelect
          id="step-config-runner"
          class="cfg-select"
          v-model="draft.runner_id"
          :options="modelOptions"
          :aria-label="t('pipelineEditor.stepConfig.model')"
        />
        <span class="cfg-hint">{{ t('pipelineEditor.stepConfig.modelHint') }}</span>
      </div>

      <label class="cfg-label">
        {{ t('pipelineEditor.stepConfig.produces') }}
        <div class="tag-row">
          <span v-for="(f, i) in draft.produces" :key="f" class="chip chip-rm" @click="removeProduces(i)">
            {{ f }} ✕
          </span>
        </div>
        <div class="tag-input-row">
          <input
            v-model="producesInput"
            class="cfg-input cfg-input-sm"
            :placeholder="t('pipelineEditor.stepConfig.producesPlaceholder')"
            @keydown.enter.prevent="addProduces"
          />
          <button type="button" class="btn-ghost btn-sm" @click="addProduces">
            {{ t('pipelineEditor.stepConfig.add') }}
          </button>
        </div>
      </label>

      <label class="cfg-label">
        {{ t('pipelineEditor.stepConfig.knowledgeInputs') }}
        <div class="tag-row">
          <span
            v-for="(kid, i) in draft.knowledge_inputs"
            :key="kid"
            class="chip chip-rm"
            @click="removeKnowledgeInput(i)"
          >{{ kid }} ✕</span>
        </div>
        <div class="tag-input-row">
          <button type="button" class="btn-ghost btn-sm" @click="showKnowledgePicker = true">
            {{ t('pipelineEditor.stepConfig.knowledgePick') }}
          </button>
        </div>
      </label>

      <div class="cfg-label">
        {{ t('pipelineEditor.stepConfig.hitlGate') }}
        <CSelect
          id="step-config-hitl-mode"
          class="cfg-select"
          v-model="draft.hitl_mode"
          :options="hitlModeOptions"
          :aria-label="t('pipelineEditor.stepConfig.hitlGate')"
        />
      </div>

      <template v-if="draft.hitl_mode !== 'none'">
        <label class="cfg-label">
          {{ t('pipelineEditor.stepConfig.gateId') }}
          <input v-model="draft.hitl_gate_id" class="cfg-input" placeholder="hitl-1" />
        </label>
        <label class="cfg-label cfg-label-row">
          <input type="checkbox" v-model="draft.hitl_optional_doc_review" />
          {{ t('pipelineEditor.stepConfig.optionalDocReview') }}
        </label>
        <label class="cfg-label cfg-label-row">
          <input type="checkbox" v-model="draft.hitl_blocking" />
          {{ t('pipelineEditor.stepConfig.blocking') }}
        </label>
      </template>
    </div>

    <template #footer>
      <div class="modal-actions">
        <button type="button" class="btn-ghost" @click="emit('close')">
          {{ t('pipelineEditor.stepConfig.cancel') }}
        </button>
        <button type="button" class="btn-primary" @click="apply">
          {{ t('pipelineEditor.stepConfig.apply') }}
        </button>
      </div>
    </template>
  </CDialog>

  <KnowledgePickerDialog
    v-if="showKnowledgePicker"
    v-model="knowledgeInputs"
    :project-id="projectId"
    @close="showKnowledgePicker = false"
  />
</template>

<style scoped lang="scss">
.step-config-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

// xem docs/agent-rules/coding-guideline.md §5
.step-config-dialog .cfg-select { width: 100%; }

.step-config-dialog .cfg-hint { font-size: 11px; opacity: 0.75; }

.cfg-label-row { flex-direction: row; align-items: center; gap: 6px; }
</style>
