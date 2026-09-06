<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { ref, computed, watch, markRaw, onBeforeUnmount } from 'vue'
import { VueFlow } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'
import { fetchFlowProfile, saveFlowProfile, patchTaskState, runPipelineStep, resetPipelineStep } from '../scripts/PipelineViewApi'
import { fetchJob, fetchJobs, cancelJob } from '../../runner/scripts/runnerApi'
import { phasesFromPipeline, phaseStatus } from '../../../core/lib/phase'
import PipelineNode from './PipelineNode.vue'
import ArtifactNode from '../../../core/ui/ArtifactNode.vue'
import { canRunWithTaskState, isRunnableTarget } from '../lib/pipelineRunGuards'
import { buildArtifactNodesAndEdges } from '../../../core/lib/pipelineArtifactGraph'

const { t } = useI18nHelpers()
const props = defineProps({
  task: { type: Object, required: true },
  projectId: { type: [String, null], default: null },
})

const emit = defineEmits(['hitl-action'])

const nodeTypes = {
  pipeline: markRaw(PipelineNode),
  artifact: markRaw(ArtifactNode),
}

// Custom flow profile for this task (null = use default PHASES).
const customProfile = ref(null)

async function loadProfile() {
  try {
    const res = await fetchFlowProfile(props.task.task_id)
    customProfile.value = res.exists ? res.profile : null
  } catch {
    customProfile.value = null
  }
}

watch(() => props.task.task_id, () => {
  customProfile.value = null
  loadProfile()
}, { immediate: true })

const NODE_SPACING = 200
const NODE_Y = 40

// Phases come from the task's resolved pipeline config (built-in ← global ←
// per-task), embedded in /api/tasks. A saved flow profile only contributes node
// positions (x/y), overlaid by key — it no longer redefines the phase list.
const phases = computed(() => {
  const base = phasesFromPipeline(props.task.pipeline)
  const pos = {}
  for (const p of customProfile.value?.phases ?? []) {
    if (p.x != null || p.y != null) pos[p.key] = { x: p.x, y: p.y }
  }
  return base.map((p, i) => ({
    ...p,
    x: pos[p.key]?.x ?? i * NODE_SPACING,
    y: pos[p.key]?.y ?? NODE_Y,
  }))
})

const phaseKeys = computed(() => phases.value.map((p) => p.key))

// Full `produces[]` for a step — unlike `phase.artifact` (first produced file
// only), needed to delete/check every file a multi-produces step wrote
// (e.g. reviewer: review.md + test-spec.md).
function stepProduces(stepId: string): string[] {
  const step = (props.task.pipeline?.steps ?? []).find((s: any) => s.id === stepId)
  return Array.isArray(step?.produces) ? step.produces : []
}

const artifactGraph = computed(() =>
  buildArtifactNodesAndEdges({
    steps: props.task.pipeline?.steps ?? [],
    phasePositions: Object.fromEntries(phases.value.map((p) => [p.key, { x: p.x, y: p.y }])),
    artifacts: props.task.artifacts ?? {},
    labels: {
      producesTitle: t('common.artifactNode.producesTitle'),
      knowledgeTitle: t('common.artifactNode.knowledgeTitle'),
    },
  }),
)

const nodes = computed(() => {
  const keys = phaseKeys.value
  const stepNodes = phases.value.map((p, i) => {
    const isActivePhase = props.task.current_phase === p.key
    const status = phaseStatus(p, props.task, keys)
    const running = runningStepId.value === p.key
    const recovering = recoveringStepId.value === p.key
    const stateOk = canRunWithTaskState(props.task)
    const inScope = isRunnableTarget(keys, props.task.current_phase, p.key)
    // Click-to-run only for current/future active|pending nodes, when state
    // is healthy and no in-flight run is already tracked for this task.
    const runnable =
      stateOk &&
      !runningStepId.value &&
      !running &&
      inScope &&
      (status === 'active' || status === 'pending')
    // "Already ran" — the only steps with a CLI session to chat with. Artifact
    // existence is checked directly (not via `status`) so a step that ran and
    // FAILED still offers chat: it stays `active` (current_phase never moved),
    // which is exactly when talking to the runner matters most.
    const artifactDone = p.artifact ? Boolean(props.task.artifacts?.[p.artifact]?.exists) : false
    const executed = artifactDone || status === 'done' || status === 'waiting' || running
    // Reset button takes the Run button's slot for steps that have already
    // run — but Run always wins when both are true (e.g. `implementer` after
    // a reviewer reject: `executed` from the earlier run, `runnable` again
    // because current_phase moved back here), so the two never show together.
    const resettable = stateOk && !runningStepId.value && !running && executed && !runnable
    return {
      id: p.key,
      type: 'pipeline',
      position: { x: p.x ?? i * NODE_SPACING, y: p.y ?? NODE_Y },
      data: {
        label: p.label,
        // Identity of the step, so the node's corner actions can open a chat
        // scoped to this step's runner session.
        taskId: props.task.task_id,
        stepId: p.key,
        status,
        hitl: p.hitl,
        // Q&A badge only on the phase that's currently active (the one that created qa.md)
        qa_count: isActivePhase ? (props.task.qa_count ?? 0) : 0,
        running,
        recovering,
        runnable,
        executed,
        resettable,
        // The node's Run button goes through the same confirm dialog as
        // clicking the node, so both paths share the overwrite warning.
        onRun: () => openRunConfirm({ id: p.key, label: p.label }),
        onReset: () => openResetConfirm({ id: p.key, label: p.label }),
        onStop: () => stopStep(),
      },
    }
  })
  return [...stepNodes, ...artifactGraph.value.artifactNodes]
})

const edges = computed((): any[] => {
  const keys = phaseKeys.value
  const control = phases.value.slice(0, -1).map((p, i) => {
    const next = phases.value[i + 1]
    const isWaiting = p.hitl && props.task.hitl_pending === p.hitl
    return {
      id: `e-${p.key}-${next.key}`,
      source: p.key,
      target: next.key,
      animated: phaseStatus(p, props.task, keys) === 'active',
      label: p.hitl || '',
      labelStyle: { fill: isWaiting ? 'var(--waiting)' : 'var(--muted)', fontWeight: isWaiting ? 700 : 400 },
      style: { stroke: isWaiting ? 'var(--waiting)' : 'var(--border)', strokeWidth: 2 },
      markerEnd: { type: 'arrowclosed', color: isWaiting ? 'var(--waiting)' : 'var(--border)' },
    }
  })
  return [...control, ...artifactGraph.value.dataFlowEdges]
})

// Persist node positions when user drags them. Positions are keyed by phase id
// and overlaid onto the config-derived phase list.
function onNodeDragStop({ node }) {
  if (node.type === 'artifact') return
  const updated = {
    phases: phases.value.map((p) =>
      p.key === node.id
        ? { key: p.key, x: Math.round(node.position.x), y: Math.round(node.position.y) }
        : { key: p.key, x: p.x, y: p.y },
    ),
  }
  saveFlowProfile(props.task.task_id, updated).then(() => {
    customProfile.value = updated
  })
}

// HITL approve/reject modal
const hitlOpen = ref(false)
const hitlTaskId = ref('')
const hitlGateId = ref('')
const hitlLabel = ref('')
const hitlMtime = ref<number | null>(null)
const hitlFeedback = ref('')
const hitlBusy = ref(false)
const hitlError = ref('')
const hitlToast = ref('')

const waitingPhase = computed(() =>
  phases.value.find((p) => phaseStatus(p, props.task, phaseKeys.value) === 'waiting' && p.hitl),
)

function openHitlModal(phase: { key: string; label: string; hitl: string | null }) {
  if (!phase.hitl) return
  hitlTaskId.value = props.task.task_id
  hitlMtime.value = props.task.state_mtime ?? null
  hitlGateId.value = phase.hitl
  hitlLabel.value = phase.label || phase.key
  hitlFeedback.value = ''
  hitlError.value = ''
  hitlOpen.value = true
}

watch(
  () => props.task.state_mtime,
  (v) => {
    if (hitlOpen.value) hitlMtime.value = v ?? null
  },
)

// Run-step (click a node to run/chain to it)
const runningStepId = ref<string | null>(null)
const recoveringStepId = ref<string | null>(null)
// The job currently being polled, so the Stop button has an id to cancel.
const activeJobId = ref<string | null>(null)
const runError = ref('')
const runToast = ref('')
let runPollTimer: ReturnType<typeof setTimeout> | null = null

function clearRunPoll() {
  if (runPollTimer != null) {
    clearTimeout(runPollTimer)
    runPollTimer = null
  }
}

/** Adopt any queued/running job for this task (e.g. "Chạy ngay" on create). */
async function syncInFlightRun() {
  if (!props.task?.task_id || !canRunWithTaskState(props.task)) return
  try {
    const data = await fetchJobs(50)
    const jobs = Array.isArray(data?.jobs) ? data.jobs : []
    const inflight = jobs.find(
      (j: any) =>
        j?.metadata?.taskId === props.task.task_id &&
        (j.status === 'queued' || j.status === 'running' || j.status === 'awaiting_recovery'),
    )
    if (!inflight?.id) {
      activeJobId.value = null
      return
    }
    const stepId =
      (typeof inflight.metadata?.pipelineStepId === 'string' && inflight.metadata.pipelineStepId) ||
      props.task.current_phase ||
      null
    runningStepId.value = stepId
    if (runPollTimer == null) pollRunStepJob(inflight.id)
  } catch {
    /* best-effort — missing jobs list must not break the pipeline view */
  }
}

watch(() => props.task.task_id, () => {
  clearRunPoll()
  runningStepId.value = null
  recoveringStepId.value = null
  activeJobId.value = null
  runError.value = ''
  syncInFlightRun()
}, { immediate: true })

onBeforeUnmount(clearRunPoll)

async function pollRunStepJob(jobId: string) {
  clearRunPoll()
  activeJobId.value = jobId
  try {
    const { job } = await fetchJob(jobId)
    if (job?.status === 'succeeded') {
      runningStepId.value = null
      recoveringStepId.value = null
      activeJobId.value = null
      runToast.value = t('monitor.pipeline.stepSucceeded')
      emit('hitl-action')
      setTimeout(() => { runToast.value = '' }, 4000)
      return
    }
    if (job?.status === 'cancelled') {
      runningStepId.value = null
      recoveringStepId.value = null
      activeJobId.value = null
      runError.value = ''
      runToast.value = t('monitor.pipeline.stepCancelled')
      emit('hitl-action')
      setTimeout(() => { runToast.value = '' }, 3000)
      return
    }
    if (job?.status === 'failed') {
      runningStepId.value = null
      recoveringStepId.value = null
      activeJobId.value = null
      runError.value = job.error ? String(job.error) : t('monitor.pipeline.stepFailed')
      emit('hitl-action')
      return
    }
    if (job?.status === 'awaiting_recovery') {
      runError.value = ''
      runToast.value = t('monitor.pipeline.stepAwaitingRecovery')
      const liveStep =
        (typeof job?.metadata?.pipelineStepId === 'string' && job.metadata.pipelineStepId) ||
        props.task.current_phase ||
        runningStepId.value
      runningStepId.value = liveStep
      recoveringStepId.value = liveStep
      runPollTimer = setTimeout(() => pollRunStepJob(jobId), 2000)
      return
    }
    recoveringStepId.value = null
    // Keep the spinner on the step the job is actually executing (server
    // always runs current_phase / metadata.pipelineStepId), not the chain target.
    const liveStep =
      (typeof job?.metadata?.pipelineStepId === 'string' && job.metadata.pipelineStepId) ||
      props.task.current_phase ||
      runningStepId.value
    runningStepId.value = liveStep
    runPollTimer = setTimeout(() => pollRunStepJob(jobId), 2000)
  } catch (e: any) {
    runningStepId.value = null
    runError.value = String(e.message || e)
  }
}

async function runStep(node: { id: string }, opts: { skipIntermediate?: boolean } = {}) {
  if (runningStepId.value) return
  if (!canRunWithTaskState(props.task)) {
    runError.value = t('monitor.pipeline.stepStateError')
    return
  }
  if (!isRunnableTarget(phaseKeys.value, props.task.current_phase, node.id)) {
    runError.value = t('monitor.pipeline.stepPastNode')
    return
  }
  runError.value = ''
  const skip = opts.skipIntermediate === true
  // Jump spinner tracks the target; chain tracks current_phase (first to execute).
  runningStepId.value = skip ? node.id : (props.task.current_phase || node.id)
  try {
    const { job } = await runPipelineStep(
      props.task.task_id,
      {
        targetStepId: node.id,
        ...(skip ? { skipIntermediate: true } : {}),
      },
      props.projectId ?? undefined,
    )
    runToast.value = t('monitor.pipeline.stepStarted')
    setTimeout(() => { runToast.value = '' }, 3000)
    pollRunStepJob(job.id)
  } catch (e: any) {
    runningStepId.value = null
    if (e?.status === 409) {
      runError.value = t('monitor.pipeline.stepAlreadyRunning')
    } else {
      runError.value = String(e.message || e)
    }
  }
}

async function stopStep() {
  if (!activeJobId.value) return
  try {
    await cancelJob(activeJobId.value)
    // pollRunStepJob's in-flight timer observes status === 'cancelled' on its
    // next tick and clears runningStepId/activeJobId — nothing to do here.
  } catch (e: any) {
    runError.value = String(e.message || e)
  }
}

// Run confirmation (click active/pending node → confirm before submitting).
// When the clicked node is ahead of current_phase with intermediate steps,
// offer Jump (skip intermediates) vs Chain (run from current). Otherwise keep
// the classic overwrite confirm. The overwrite warning checks the clicked
// node's own artifact.
const runConfirmOpen = ref(false)
const runConfirmNode = ref<{ id: string; label: string } | null>(null)
const runConfirmOverwrite = ref<string[]>([])
const runConfirmSkipLabels = ref<string[]>([])

function intermediateSkipLabels(targetId: string): string[] {
  const keys = phaseKeys.value
  const current = String(props.task.current_phase ?? '')
  const curIdx = keys.indexOf(current)
  const tgtIdx = keys.indexOf(targetId)
  if (curIdx < 0 || tgtIdx < 0 || tgtIdx <= curIdx + 1) return []
  return keys.slice(curIdx, tgtIdx).map((key) => {
    const p = phases.value.find((ph) => ph.key === key)
    return p?.label || key
  })
}

function openRunConfirm(node: { id: string; label: string }) {
  runConfirmNode.value = node
  const clickedPhase = phases.value.find((p) => p.key === node.id)
  runConfirmOverwrite.value =
    clickedPhase?.artifact && props.task.artifacts?.[clickedPhase.artifact]?.exists
      ? [clickedPhase.artifact]
      : []
  runConfirmSkipLabels.value = intermediateSkipLabels(node.id)
  runConfirmOpen.value = true
}

function cancelRunConfirm() {
  runConfirmOpen.value = false
  runConfirmNode.value = null
  runConfirmOverwrite.value = []
  runConfirmSkipLabels.value = []
}

function confirmRunStep(skipIntermediate = false) {
  const node = runConfirmNode.value
  runConfirmOpen.value = false
  runConfirmNode.value = null
  runConfirmOverwrite.value = []
  runConfirmSkipLabels.value = []
  if (node) runStep(node, { skipIntermediate })
}

// Reset-step confirmation (click the recycle button on an already-run step).
const resetConfirmOpen = ref(false)
const resetConfirmNode = ref<{ id: string; label: string } | null>(null)
const resetConfirmOverwrite = ref<string[]>([])
const resetConfirmCascadeLabels = ref<string[]>([])
// Union of produces across target + every cascaded step, for the delete
// warning shown when cascade is an available option — must list everything
// that a cascade delete would remove, not just the clicked node's own files
// (a partial list here is how someone accidentally nukes downstream artifacts
// they didn't know were about to go).
const resetConfirmCascadeFiles = ref<string[]>([])
const resetError = ref('')
const resetToast = ref('')

function openResetConfirm(node: { id: string; label: string }) {
  resetConfirmNode.value = node
  resetConfirmOverwrite.value = stepProduces(node.id).filter((f) => props.task.artifacts?.[f]?.exists)
  const keys = phaseKeys.value
  const idx = keys.indexOf(node.id)
  const afterKeys = idx >= 0 ? keys.slice(idx + 1) : []
  resetConfirmCascadeLabels.value = afterKeys
    .filter((k) => stepProduces(k).some((f) => props.task.artifacts?.[f]?.exists))
    .map((k) => phases.value.find((p) => p.key === k)?.label || k)
  const cascadeSteps = [node.id, ...afterKeys]
  resetConfirmCascadeFiles.value = Array.from(
    new Set(cascadeSteps.flatMap((k) => stepProduces(k).filter((f) => props.task.artifacts?.[f]?.exists))),
  )
  resetError.value = ''
  resetConfirmOpen.value = true
}

function cancelResetConfirm() {
  resetConfirmOpen.value = false
  resetConfirmNode.value = null
  resetConfirmOverwrite.value = []
  resetConfirmCascadeLabels.value = []
  resetConfirmCascadeFiles.value = []
}

async function doResetStep(node: { id: string; label: string }, cascade: boolean) {
  resetError.value = ''
  try {
    await resetPipelineStep(props.task.task_id, { stepId: node.id, cascade }, props.projectId ?? undefined)
    resetToast.value = t('monitor.pipeline.resetDone')
    emit('hitl-action')
    setTimeout(() => { resetToast.value = '' }, 3000)
  } catch (e: any) {
    if (e?.status === 409) {
      resetError.value = t('monitor.pipeline.stepAlreadyRunning')
    } else {
      resetError.value = String(e.message || e)
    }
  }
}

function confirmReset(cascade: boolean) {
  const node = resetConfirmNode.value
  resetConfirmOpen.value = false
  resetConfirmNode.value = null
  resetConfirmOverwrite.value = []
  resetConfirmCascadeLabels.value = []
  resetConfirmCascadeFiles.value = []
  if (node) doResetStep(node, cascade)
}

function onNodeClick({ node }) {
  if (node.type === 'artifact') return
  if (node.data?.status === 'waiting' && node.data?.hitl) {
    openHitlModal({ key: node.id, label: node.data.label, hitl: node.data.hitl })
    return
  }
  // Prefer the precomputed `runnable` flag (state_ok, in-flight, current/future).
  if (node.data?.runnable) {
    openRunConfirm({ id: node.id, label: node.data.label })
    return
  }
  if (node.data?.status !== 'active' && node.data?.status !== 'pending') return
  if (runningStepId.value) {
    runError.value = t('monitor.pipeline.stepAlreadyRunning')
    return
  }
  if (!canRunWithTaskState(props.task)) {
    runError.value = t('monitor.pipeline.stepStateError')
    return
  }
  // Past pending node while current is further ahead — explain instead of
  // silently starting current_phase (which looks like "clicked design, ran implement").
  if (!isRunnableTarget(phaseKeys.value, props.task.current_phase, node.id)) {
    runError.value = t('monitor.pipeline.stepPastNode')
  }
}

async function submitHitl(action: 'approve' | 'reject') {
  if (hitlMtime.value == null) {
    hitlError.value = t('monitor.pipeline.missingMtime')
    return
  }
  hitlBusy.value = true
  hitlError.value = ''
  try {
    await patchTaskState(
      hitlTaskId.value,
      {
        action,
        gate_id: hitlGateId.value,
        feedback: action === 'reject' ? hitlFeedback.value : undefined,
        mtime: hitlMtime.value,
      },
      props.projectId ?? undefined,
    )
    hitlOpen.value = false
    hitlToast.value = action === 'approve' ? t('monitor.pipeline.approved') : t('monitor.pipeline.rejected')
    emit('hitl-action')
    setTimeout(() => { hitlToast.value = '' }, 3000)
  } catch (e: any) {
    if (e?.status === 409) {
      hitlError.value = t('monitor.pipeline.stateChanged')
      hitlMtime.value = e?.body?.mtime ?? props.task.state_mtime ?? null
      emit('hitl-action')
    } else {
      hitlError.value = String(e.message || e)
    }
  } finally {
    hitlBusy.value = false
  }
}
</script>

<template>
  <section class="pipeline-wrap">
    <div v-if="hitlToast || runToast || runError || resetToast || resetError || waitingPhase" class="pipeline-toolbar">
      <span v-if="hitlToast" class="chip chip-ok">{{ hitlToast }}</span>
      <span v-if="runToast" class="chip chip-ok">{{ runToast }}</span>
      <span v-if="runError" class="chip chip-err">{{ runError }}</span>
      <span v-if="resetToast" class="chip chip-ok">{{ resetToast }}</span>
      <span v-if="resetError" class="chip chip-err">{{ resetError }}</span>
    </div>

    <div class="vflow-container">
      <VueFlow
        :nodes="nodes"
        :edges="edges"
        :node-types="nodeTypes"
        fit-view-on-init
        :zoom-on-scroll="false"
        :pan-on-drag="true"
        :nodes-draggable="true"
        :elements-selectable="false"
        @node-drag-stop="onNodeDragStop"
        @node-click="onNodeClick"
        class="vflow"
      />
    </div>

    <section
      v-if="task.inherit_from_parent?.length || task.subtasks?.length"
      class="meta-row"
    >
      <span v-if="task.inherit_from_parent?.length" class="chip">
        {{ t('monitor.pipeline.inherit', { list: task.inherit_from_parent.join(', ') }) }}
      </span>
      <span v-if="task.subtasks?.length" class="chip">
        subtask: {{ task.subtasks.join(', ') }}
      </span>
    </section>
  </section>

  <!-- HITL approve modal -->
  <Teleport to="body">
    <div v-if="hitlOpen" class="modal-backdrop" @click.self="hitlOpen = false">
      <div class="modal">
        <div class="modal-head">
          <span>{{ t('monitor.pipeline.hitlHeading', { label: hitlLabel }) }}</span>
          <button class="modal-close" @click="hitlOpen = false">✕</button>
        </div>
        <div class="modal-body">
          <p class="modal-hint">
            {{ t('monitor.pipeline.hitlWaiting') }} <code>{{ hitlGateId }}</code> {{ t('monitor.pipeline.hitlWaitingMid') }} <strong>{{ hitlTaskId }}</strong>.
          </p>
          <label class="hitl-feedback-label">
            {{ t('monitor.pipeline.feedbackLabel') }}
            <textarea v-model="hitlFeedback" class="profile-editor hitl-feedback" rows="3" />
          </label>
          <p v-if="hitlError" class="editor-error">{{ hitlError }}</p>
        </div>
        <div class="modal-actions">
          <button class="btn-ghost" :disabled="hitlBusy" @click="submitHitl('reject')">{{ t('monitor.pipeline.reject') }}</button>
          <button class="btn-primary" :disabled="hitlBusy" @click="submitHitl('approve')">
            {{ hitlBusy ? t('monitor.pipeline.saving') : t('monitor.pipeline.approve') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Run-step confirm modal -->
  <Teleport to="body">
    <div v-if="runConfirmOpen" class="modal-backdrop" @click.self="cancelRunConfirm">
      <div class="modal">
        <div class="modal-head">
          <span>{{
            runConfirmSkipLabels.length
              ? t('monitor.pipeline.runConfirmSkipHeading')
              : t('monitor.pipeline.runConfirmHeading', { label: runConfirmNode?.label ?? '' })
          }}</span>
          <button class="modal-close" @click="cancelRunConfirm">✕</button>
        </div>
        <div class="modal-body">
          <template v-if="runConfirmSkipLabels.length">
            <p class="modal-hint">
              {{ t('monitor.pipeline.runConfirmSkipBody', { steps: runConfirmSkipLabels.join(', ') }) }}
            </p>
            <p v-if="runConfirmOverwrite.length" class="editor-error">
              {{ t('monitor.pipeline.runConfirmOverwriteWarning', { files: runConfirmOverwrite.join(', ') }) }}
            </p>
          </template>
          <template v-else>
            <p class="modal-hint">{{ t('monitor.pipeline.runConfirmBody') }}</p>
            <p v-if="runConfirmOverwrite.length" class="editor-error">
              {{ t('monitor.pipeline.runConfirmOverwriteWarning', { files: runConfirmOverwrite.join(', ') }) }}
            </p>
          </template>
        </div>
        <div v-if="runConfirmSkipLabels.length" class="modal-actions">
          <button class="btn-ghost" @click="cancelRunConfirm">{{ t('monitor.pipeline.runConfirmCancel') }}</button>
          <button class="btn-ghost" @click="confirmRunStep(false)">
            {{ t('monitor.pipeline.runConfirmChainFromCurrent') }}
          </button>
          <button class="btn-primary" @click="confirmRunStep(true)">
            {{ t('monitor.pipeline.runConfirmJumpOnly', { label: runConfirmNode?.label ?? '' }) }}
          </button>
        </div>
        <div v-else class="modal-actions">
          <button class="btn-ghost" @click="cancelRunConfirm">{{ t('monitor.pipeline.runConfirmCancel') }}</button>
          <button class="btn-primary" @click="confirmRunStep(false)">
            {{ runConfirmOverwrite.length ? t('monitor.pipeline.runConfirmRunOverwrite') : t('monitor.pipeline.runConfirmRun') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Reset-step confirm modal -->
  <Teleport to="body">
    <div v-if="resetConfirmOpen" class="modal-backdrop" @click.self="cancelResetConfirm">
      <div class="modal">
        <div class="modal-head">
          <span>{{ t('monitor.pipeline.resetConfirmHeading', { label: resetConfirmNode?.label ?? '' }) }}</span>
          <button class="modal-close" @click="cancelResetConfirm">✕</button>
        </div>
        <div class="modal-body">
          <template v-if="resetConfirmCascadeLabels.length">
            <p class="modal-hint">
              {{ t('monitor.pipeline.resetConfirmCascadeBody', { label: resetConfirmNode?.label ?? '' }) }}
            </p>
            <p v-if="resetConfirmCascadeFiles.length" class="editor-error">
              {{ t('monitor.pipeline.resetConfirmDeleteWarning', { files: resetConfirmCascadeFiles.join(', ') }) }}
            </p>
          </template>
          <template v-else>
            <p class="modal-hint">{{ t('monitor.pipeline.resetConfirmBody', { label: resetConfirmNode?.label ?? '' }) }}</p>
            <p v-if="resetConfirmOverwrite.length" class="editor-error">
              {{ t('monitor.pipeline.resetConfirmDeleteWarning', { files: resetConfirmOverwrite.join(', ') }) }}
            </p>
          </template>
        </div>
        <div v-if="resetConfirmCascadeLabels.length" class="modal-actions">
          <button class="btn-ghost" @click="cancelResetConfirm">{{ t('monitor.pipeline.runConfirmCancel') }}</button>
          <button class="btn-ghost" @click="confirmReset(false)">
            {{ t('monitor.pipeline.resetConfirmOnlyThis') }}
          </button>
          <button class="btn-primary" @click="confirmReset(true)">
            {{ t('monitor.pipeline.resetConfirmCascade', { steps: resetConfirmCascadeLabels.join(', ') }) }}
          </button>
        </div>
        <div v-else class="modal-actions">
          <button class="btn-ghost" @click="cancelResetConfirm">{{ t('monitor.pipeline.runConfirmCancel') }}</button>
          <button class="btn-primary" @click="confirmReset(false)">
            {{ t('monitor.pipeline.resetConfirmOnlyThis') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.pipeline-wrap { margin-bottom: 14px; }

/* bù gap của .modal bị mất khi bọc nội dung vào .modal-body */
.modal-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pipeline-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

/* Flow profile editor modal */

.profile-editor {
  flex: 1;
  min-height: 320px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-family: ui-monospace, monospace;
  font-size: 12px;
  padding: 12px;
  resize: vertical;
}
.editor-error { color: var(--danger); font-size: 12px; margin: 0; }
</style>
