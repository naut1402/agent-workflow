<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { computed, inject, onMounted } from 'vue'
import { useAgentBuild } from '../composables/useAgentBuild'
import { navigateToModeKey } from '../../../core/shell/keys'

// Merged NL build wizard (Correction A / F0005): describe → preview → optional
// "Lưu & chạy thử" smoke-run, replacing both the draft-only AS-IS wizard here
// and the Monitor-only `AgentBuildWizard` (deleted — this is now the single
// entry point). Agent Editor has no task context, so the smoke job always
// runs in the `custom-agents` sandbox workspace.

const { t } = useI18nHelpers()
const props = defineProps<{
  projectId?: string | null
}>()

const emit = defineEmits<{
  (e: 'apply-draft', draft: Record<string, unknown>): void
  (e: 'close'): void
}>()

// Provided by App.vue so any nested wizard/panel can switch the shell to the
// Runner mode without bubbling a custom event through every intermediate
// component.
const navigateToMode = inject(navigateToModeKey, undefined)

const build = useAgentBuild({
  getProjectId: () => props.projectId ?? null,
  getWorkspace: () => 'custom-agents',
})

onMounted(() => {
  build.loadRunners()
})

// Skills are edited as a comma/newline separated string then normalised back
// to the draft array so the persisted agent keeps its structured shape.
const skillsText = computed<string>({
  get: () => (build.draft.value?.skills ?? []).join(', '),
  set: (v: string) => {
    if (!build.draft.value) return
    build.draft.value.skills = v
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
  },
})

const jobBadge = computed(() => {
  const s = build.jobStatus.value
  if (!s) return { label: t('agentEditor.nl.statusInit'), cls: 'pending' }
  if (s === 'succeeded') return { label: t('agentEditor.nl.statusOk'), cls: 'ok' }
  if (s === 'failed' || s === 'cancelled') return { label: s, cls: 'err' }
  return { label: s, cls: 'pending' }
})

function applyToEditor() {
  if (!build.draft.value) return
  emit('apply-draft', { ...build.draft.value })
  emit('close')
}

function goToRunner() {
  navigateToMode?.('runner')
}

function close() {
  if (build.running.value) return
  emit('close')
}
</script>

<template>
  <div class="agent-nl-wizard">
    <div class="nl-wizard-head">
      <h3 class="picker-title">{{ t('agentEditor.nl.title') }}</h3>
      <button type="button" class="modal-close" @click="close">✕</button>
    </div>

    <ol class="wizard-steps">
      <li :class="{ current: build.step.value === 'describe', done: build.step.value !== 'describe' }">{{ t('agentEditor.nl.stepDescribe') }}</li>
      <li :class="{ current: build.step.value === 'preview', done: build.step.value === 'run' }">{{ t('agentEditor.nl.stepPreview') }}</li>
      <li :class="{ current: build.step.value === 'run' }">{{ t('agentEditor.nl.stepRun') }}</li>
    </ol>

    <!-- Step 1: describe -->
    <section v-if="build.step.value === 'describe'" class="wizard-body">
      <p class="muted">
        {{ t('agentEditor.nl.describeHint') }}
        <code>ANTHROPIC_API_KEY</code>).
      </p>
      <textarea
        v-model="build.description.value"
        class="cfg-textarea"
        rows="6"
        :placeholder="t('agentEditor.nl.describePlaceholder')"
      />
      <p v-if="build.error.value" class="err">{{ build.error.value }}</p>
      <div class="nl-actions">
        <button type="button" class="btn-primary" :disabled="build.generating.value" @click="build.generate()">
          {{ build.generating.value ? t('agentEditor.nl.generating') : t('agentEditor.nl.generate') }}
        </button>
        <button type="button" class="btn-ghost" @click="close">{{ t('agentEditor.nl.cancel') }}</button>
      </div>
    </section>

    <!-- Step 2: preview & edit -->
    <section v-else-if="build.step.value === 'preview' && build.draft.value" class="wizard-body">
      <p class="muted">{{ t('agentEditor.nl.previewHint') }}</p>
      <label class="cfg-label">
        {{ t('agentEditor.nl.nameLabel') }}
        <input v-model="build.draft.value.name" class="cfg-input" type="text" placeholder="ten-agent" />
      </label>
      <label class="cfg-label">
        {{ t('agentEditor.nl.descriptionLabel') }}
        <input v-model="build.draft.value.description" class="cfg-input" type="text" />
      </label>
      <label class="cfg-label">
        {{ t('agentEditor.nl.skillsLabel') }}
        <input v-model="skillsText" class="cfg-input" type="text" placeholder="run-phpstan, coding-rules" />
      </label>
      <details v-if="build.draft.value.sections" class="sections-preview">
        <summary>Sections ({{ Object.keys(build.draft.value.sections).length }})</summary>
        <div v-for="(content, key) in build.draft.value.sections" :key="key" class="section-block">
          <strong>{{ key }}</strong>
          <pre>{{ content || '—' }}</pre>
        </div>
      </details>

      <label class="cfg-label">
        Runner
        <select v-model="build.selectedRunnerId.value" class="cfg-input">
          <option v-if="!build.usableRunners.value.length" :value="null" disabled>
            {{ t('agentEditor.nl.noRunnerParen') }}
          </option>
          <option v-for="r in build.usableRunners.value" :key="r.id" :value="r.id">
            {{ r.name || r.id }}
          </option>
        </select>
      </label>
      <p v-if="!build.hasUsableRunner.value" class="err">
        {{ t('agentEditor.nl.noRunner') }}
        <button type="button" class="btn-link" @click="goToRunner">{{ t('agentEditor.nl.openRunner') }}</button>
        {{ t('agentEditor.nl.noRunnerSuffix') }}
      </p>

      <p v-if="build.error.value" class="err">{{ build.error.value }}</p>
      <div class="nl-actions">
        <button type="button" class="btn-ghost" @click="build.backToDescribe()">{{ t('agentEditor.nl.back') }}</button>
        <button type="button" class="btn-primary" @click="applyToEditor">{{ t('agentEditor.nl.applyEditor') }}</button>
        <button
          type="button"
          class="btn-primary"
          :disabled="build.running.value || !build.hasUsableRunner.value"
          @click="build.buildAndRun()"
        >
          {{ t('agentEditor.nl.saveAndRun') }}
        </button>
      </div>
    </section>

    <!-- Step 3: run status -->
    <section v-else-if="build.step.value === 'run'" class="wizard-body">
      <p class="muted">
        Agent <strong>{{ build.savedName.value || build.draft.value?.name }}</strong> —
        <span class="job-badge" :class="jobBadge.cls">{{ jobBadge.label }}</span>
      </p>
      <p v-if="build.jobId.value" class="muted">Job: <code>{{ build.jobId.value }}</code></p>
      <p v-if="build.running.value" class="muted">{{ t('agentEditor.nl.waitingRunner') }}</p>
      <p v-if="build.jobError.value" class="err">{{ build.jobError.value }}</p>
      <p v-if="build.jobLogPath.value" class="muted">Log: <code>{{ build.jobLogPath.value }}</code></p>
      <p v-if="build.jobStatus.value === 'succeeded'" class="chip chip-ok">
        {{ t('agentEditor.nl.success') }}
      </p>
      <div class="nl-actions">
        <button type="button" class="btn-ghost" :disabled="build.running.value" @click="build.backToPreview()">
          {{ t('agentEditor.nl.editDraft') }}
        </button>
        <button type="button" class="btn-primary" :disabled="build.running.value" @click="applyToEditor">
          {{ t('agentEditor.nl.applyEditor') }}
        </button>
        <button type="button" class="btn-ghost" :disabled="build.running.value" @click="close">{{ t('agentEditor.nl.close') }}</button>
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
.agent-nl-wizard { margin-bottom: 12px; }
.nl-wizard-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.wizard-steps {
  display: flex;
  gap: 0.5rem;
  list-style: none;
  padding: 0;
  margin: 0 0 0.75rem;
  font-size: 0.8rem;
}
.wizard-steps li {
  flex: 1;
  padding: 0.35rem 0.5rem;
  border-radius: 6px;
  background: var(--panel-2);
  color: var(--muted);
  text-align: center;
}
.wizard-steps li.current {
  color: var(--text);
  font-weight: 600;
  outline: 1px solid var(--accent);
}
.wizard-steps li.done {
  color: var(--ok);
}
.wizard-body {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.sections-preview {
  font-size: 0.8rem;
}
.section-block pre {
  white-space: pre-wrap;
  max-height: 8rem;
  overflow: auto;
  background: var(--panel-2);
  padding: 0.4rem;
  border-radius: 4px;
}
.job-badge {
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  font-weight: 600;
}
.job-badge.ok { color: var(--ok); }
.job-badge.err { color: var(--err); }
.job-badge.pending { color: var(--waiting, #d0a215); }
</style>
