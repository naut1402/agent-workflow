<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import JobLogStream from '../../../core/ui/JobLogStream.vue'
import KnowledgePickerDialog from '../../../core/ui/KnowledgePickerDialog.vue'
import WizardStepper from '../../../core/ui/WizardStepper.vue'
import { CREATE_TASK_STEPS, useCreateTask } from '../composables/useCreateTask'

const props = defineProps<{
  projectId?: string | null
}>()

const emit = defineEmits<{
  close: []
  created: [payload: { taskId: string; jobId: string | null }]
}>()

const { t } = useI18n()
const showKnowledgePicker = ref(false)

const {
  step,
  form,
  loading,
  error,
  issuePreview,
  issueLoaded,
  profiles,
  runners,
  taskIdError,
  previewSummary,
  canNext,
  maxReachableStep,
  submittedJobId,
  createdTaskId,
  firstStepLabel,
  reset,
  loadMeta,
  ensureRunnerSelected,
  refreshFirstStepLabel,
  fetchIssue,
  next,
  back,
  goToStep,
  toggleKnowledge,
  submit,
} = useCreateTask({
  getProjectId: () => props.projectId ?? null,
})

const showingLog = computed(() => Boolean(submittedJobId.value && form.value.run))

const steps = computed(() => [
  { key: 'source', label: t('monitor.createTask.stepSource') },
  { key: 'pipeline', label: t('monitor.createTask.stepPipeline') },
  { key: 'knowledge', label: t('monitor.createTask.stepKnowledge') },
  { key: 'preview', label: t('monitor.createTask.stepPreview') },
])

async function onOpen() {
  await loadMeta()
}

watch(
  () => form.value.profileName,
  () => void refreshFirstStepLabel(),
)

watch(
  () => form.value.run,
  (run) => {
    if (run) ensureRunnerSelected()
  },
)

watch(
  () => form.value.source,
  (src) => {
    if (src === 'prompt') {
      issueLoaded.value = false
      issuePreview.value = null
    }
  },
)

/** Step 1 with source=issue only stores a URL — the prompt arrives via fetch. */
function needsIssueFetch() {
  return step.value === 1 && form.value.source === 'issue' && !issueLoaded.value
}

async function handleNext() {
  if (needsIssueFetch()) {
    await fetchIssue()
    if (issueLoaded.value) next()
    return
  }
  next()
}

/**
 * Stepper click. Leaving step 1 forward on the issue tab must still fetch first,
 * otherwise the jump lands on preview with an empty prompt.
 */
async function handleStepJump(target: number) {
  if (target > step.value && needsIssueFetch()) {
    await fetchIssue()
    if (!issueLoaded.value) return
  }
  goToStep(target)
}

async function handleSubmit() {
  const result = await submit()
  if (!result) return
  if (!form.value.run) {
    emit('created', result)
    emit('close')
  }
}

function handleDoneAfterRun() {
  if (createdTaskId.value) {
    emit('created', {
      taskId: createdTaskId.value,
      jobId: submittedJobId.value,
    })
  }
  emit('close')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && !showKnowledgePicker.value) emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  void onOpen()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  reset()
})
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop create-task-backdrop" @click.self="emit('close')">
      <div
        class="modal create-task-dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="t('monitor.createTask.title')"
      >
        <div class="modal-head">
          <!-- Step name lives in the stepper below; keep the head to title + counter. -->
          <span>{{ t('monitor.createTask.title') }}</span>
          <span class="create-task-step">{{ step }}/{{ CREATE_TASK_STEPS }}</span>
          <button
            type="button"
            class="modal-close"
            :aria-label="t('monitor.createTask.close')"
            @click="emit('close')"
          >
            ✕
          </button>
        </div>

        <WizardStepper
          v-if="!showingLog"
          class="create-task-stepper"
          :steps="steps"
          :current="step"
          :max-reachable="maxReachableStep"
          :disabled="loading"
          :aria-label="t('monitor.createTask.stepperLabel')"
          @go="handleStepJump"
        />

        <div class="modal-body create-task-body">
          <div v-if="error" class="err-banner">⚠ {{ error }}</div>

          <!-- Step 1: source -->
          <template v-if="step === 1">
            <label class="cfg-label">
              {{ t('monitor.createTask.taskId') }}
              <input
                v-model="form.taskId"
                class="cfg-input"
                :placeholder="t('monitor.createTask.taskIdPlaceholder')"
                autocomplete="off"
              />
            </label>
            <p v-if="taskIdError" class="field-err">
              {{ t(`monitor.createTask.errors.${taskIdError}`) }}
            </p>

            <div class="create-task-tabs" role="tablist">
              <button
                type="button"
                class="create-task-tab"
                :class="{ active: form.source === 'prompt' }"
                role="tab"
                @click="form.source = 'prompt'"
              >
                {{ t('monitor.createTask.tabPrompt') }}
              </button>
              <button
                type="button"
                class="create-task-tab"
                :class="{ active: form.source === 'issue' }"
                role="tab"
                @click="form.source = 'issue'"
              >
                {{ t('monitor.createTask.tabIssue') }}
              </button>
            </div>

            <template v-if="form.source === 'prompt'">
              <label class="cfg-label">
                {{ t('monitor.createTask.prompt') }}
                <textarea
                  v-model="form.prompt"
                  class="cfg-input create-task-prompt"
                  rows="8"
                  :placeholder="t('monitor.createTask.promptPlaceholder')"
                />
              </label>
            </template>

            <template v-else>
              <label class="cfg-label">
                {{ t('monitor.createTask.issueUrl') }}
                <input
                  v-model="form.issueUrl"
                  class="cfg-input"
                  type="url"
                  :placeholder="t('monitor.createTask.issueUrlPlaceholder')"
                />
              </label>
              <button
                type="button"
                class="btn-ghost btn-sm"
                :disabled="loading || !form.issueUrl.trim()"
                @click="fetchIssue()"
              >
                {{ loading ? t('monitor.createTask.loading') : t('monitor.createTask.fetchIssue') }}
              </button>
              <p v-if="issuePreview" class="muted">
                {{ issuePreview.title }}
              </p>
              <label v-if="issueLoaded" class="cfg-label">
                {{ t('monitor.createTask.prompt') }}
                <textarea v-model="form.prompt" class="cfg-input create-task-prompt" rows="8" />
              </label>
            </template>
          </template>

          <!-- Step 2: pipeline -->
          <template v-else-if="step === 2">
            <p class="modal-hint">{{ t('monitor.createTask.pipelineHint') }}</p>
            <label class="cfg-label">
              {{ t('monitor.createTask.profile') }}
              <select v-model="form.profileName" class="cfg-input">
                <option value="">{{ t('monitor.createTask.profileDefault') }}</option>
                <option v-for="p in profiles" :key="p.name" :value="p.name">
                  {{ p.name }}
                </option>
              </select>
            </label>
            <p v-if="firstStepLabel" class="muted">
              {{ t('monitor.createTask.firstStep', { step: firstStepLabel }) }}
            </p>
            <div class="create-task-flags">
              <label class="checkbox-row">
                <input v-model="form.autoReview" type="checkbox" />
                {{ t('monitor.createTask.autoReview') }}
              </label>
              <label class="checkbox-row">
                <input v-model="form.exportJson" type="checkbox" />
                {{ t('monitor.createTask.exportJson') }}
              </label>
            </div>
          </template>

          <!-- Step 3: knowledge -->
          <template v-else-if="step === 3">
            <p class="modal-hint">{{ t('monitor.createTask.knowledgeHint') }}</p>
            <ul v-if="form.knowledgeInputs.length" class="create-task-knowledge-chips">
              <li v-for="id in form.knowledgeInputs" :key="id">
                <code>{{ id }}</code>
                <button
                  type="button"
                  class="icon-btn"
                  :title="t('monitor.createTask.removeKnowledge')"
                  :aria-label="t('monitor.createTask.removeKnowledge')"
                  @click="toggleKnowledge(id)"
                >
                  ✕
                </button>
              </li>
            </ul>
            <p v-else class="muted">{{ t('monitor.createTask.knowledgeNone') }}</p>
            <button type="button" class="btn-ghost btn-sm" @click="showKnowledgePicker = true">
              {{ t('monitor.createTask.openKnowledgePicker') }}
            </button>
          </template>

          <!-- Step 4: preview -->
          <template v-else>
            <template v-if="!showingLog">
              <dl class="create-task-preview">
                <dt>{{ t('monitor.createTask.previewTaskId') }}</dt>
                <dd><code>{{ previewSummary.taskId }}</code></dd>
                <dt>{{ t('monitor.createTask.previewSource') }}</dt>
                <dd>{{ previewSummary.source }}</dd>
                <dt v-if="previewSummary.profileName">{{ t('monitor.createTask.profile') }}</dt>
                <dd v-if="previewSummary.profileName">{{ previewSummary.profileName }}</dd>
                <dt>{{ t('monitor.createTask.previewKnowledge') }}</dt>
                <dd>
                  {{
                    previewSummary.knowledgeCount
                      ? previewSummary.knowledgeInputs.join(', ')
                      : t('monitor.createTask.knowledgeNone')
                  }}
                </dd>
                <dt>{{ t('monitor.createTask.prompt') }}</dt>
                <dd><pre class="create-task-preview-prompt">{{ form.prompt }}</pre></dd>
              </dl>

              <label class="checkbox-row">
                <input v-model="form.run" type="checkbox" />
                {{ t('monitor.createTask.runNow') }}
              </label>
              <label v-if="form.run" class="cfg-label">
                {{ t('monitor.createTask.runner') }}
                <select v-model="form.runnerId" class="cfg-input" required>
                  <option value="" disabled>
                    {{ t('monitor.createTask.runnerPlaceholder') }}
                  </option>
                  <option v-for="r in runners" :key="r.id" :value="r.id">{{ r.name }}</option>
                </select>
              </label>
              <p v-if="form.run && !runners.length" class="field-err">
                {{ t('monitor.createTask.noRunner') }}
              </p>
            </template>

            <JobLogStream v-else :job-id="submittedJobId" :active="true" />
          </template>
        </div>

        <div class="modal-actions create-task-foot">
          <template v-if="showingLog">
            <button type="button" class="btn-primary" @click="handleDoneAfterRun">
              {{ t('monitor.createTask.done') }}
            </button>
          </template>
          <template v-else>
            <button
              v-if="step > 1"
              type="button"
              class="btn-ghost"
              :disabled="loading"
              @click="back()"
            >
              {{ t('monitor.createTask.back') }}
            </button>
            <span class="spacer" />
            <button type="button" class="btn-ghost" @click="emit('close')">
              {{ t('monitor.createTask.cancel') }}
            </button>
            <button
              v-if="step < CREATE_TASK_STEPS"
              type="button"
              class="btn-primary"
              :disabled="!canNext || loading"
              @click="handleNext"
            >
              {{ t('monitor.createTask.next') }}
            </button>
            <button
              v-else
              type="button"
              class="btn-primary"
              :disabled="loading || (form.run && !runners.length)"
              @click="handleSubmit"
            >
              {{ loading ? t('monitor.createTask.creating') : t('monitor.createTask.create') }}
            </button>
          </template>
        </div>
      </div>
    </div>

    <KnowledgePickerDialog
      v-if="showKnowledgePicker"
      v-model="form.knowledgeInputs"
      :project-id="projectId"
      @close="showKnowledgePicker = false"
    />
  </Teleport>
</template>

<style scoped lang="scss">
.create-task-dialog {
  width: min(620px, 94vw);
  max-height: min(720px, 92vh);
  display: flex;
  flex-direction: column;
}

.create-task-step {
  margin-left: auto;
  margin-right: 8px;
  font-size: 12px;
  opacity: 0.65;
}

/* Sits between head and the scrollable body — must not shrink or scroll away. */
.create-task-stepper {
  flex: 0 0 auto;
  padding: 6px 0 8px;
  border-bottom: 1px solid var(--border);
}

.create-task-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  min-height: 0;
}

.create-task-tabs {
  display: flex;
  gap: 4px;
}

.create-task-tab {
  flex: 1;
  border: none;
  background: var(--panel-2, transparent);
  color: inherit;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
}

.create-task-tab.active {
  background: rgba(var(--accent-rgb), 0.15);
  color: var(--accent);
}

.create-task-prompt {
  min-height: 140px;
  resize: vertical;
  font-family: inherit;
}

.create-task-flags {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.checkbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  cursor: pointer;
}

.create-task-knowledge-chips {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.create-task-knowledge-chips li {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  background: var(--panel-2);
  border-radius: 4px;
  font-size: 12px;
}

.create-task-preview {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 12px;
  margin: 0;
  font-size: 13px;
}

.create-task-preview dt {
  opacity: 0.7;
}

.create-task-preview dd {
  margin: 0;
}

.create-task-preview-prompt {
  margin: 0;
  max-height: 160px;
  overflow: auto;
  white-space: pre-wrap;
  font-size: 12px;
  background: var(--panel-2);
  padding: 8px;
  border-radius: 4px;
}

.field-err {
  color: var(--danger);
  font-size: 12px;
  margin: 0;
}

.err-banner {
  background: rgba(248, 81, 73, 0.12);
  border: 1px solid var(--danger);
  color: var(--danger);
  padding: 8px;
  border-radius: 6px;
  font-size: 13px;
}

.create-task-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}

.spacer {
  flex: 1;
}
</style>
