<script setup lang="ts">
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'
import { ref, computed, watch, markRaw, onBeforeUnmount } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'
import { fetchFlowProfile, saveFlowProfile, patchTaskState, runPipelineStep, resetPipelineStep, startOrchestrator, stopOrchestrator } from '../scripts/PipelineViewApi'
import { fetchJob, fetchJobs, cancelJob } from '../../runner/scripts/runnerApi'
import { phasesFromPipeline, phaseStatus } from '../../../shared/lib/phase'
import PipelineNode from './PipelineNode.vue'
import ProfileSwitchDialog from './ProfileSwitchDialog.vue'
import Icon from '../../../frontend/ui/Icon.vue'
import ArtifactNode from '../../../frontend/ui/ArtifactNode.vue'
import { canRunWithTaskState, isRunnableTarget } from '../lib/pipelineRunGuards'
import { buildArtifactNodesAndEdges } from '../../../frontend/lib/pipelineArtifactGraph'
import {
  ORCHESTRATOR_NODE_ID,
  isOrchestratorNode,
  orchestratorPositionOf,
} from '../../../frontend/lib/orchestratorNode'

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

const { fitView } = useVueFlow()

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

/**
 * Điều phối đang cầm lái: node step không cho Run/Reset (server cũng từ chối
 * bằng 403), chỉ còn chat. Halt ⇒ về chế độ tay, nút hiện lại ngay.
 */
const orchestratorEnabled = computed(() => props.task.pipeline?.orchestrator?.enabled === true)
const orchestratorHalted = computed(() => props.task.orchestrator_halted === true)
const orchestrated = computed(() => orchestratorEnabled.value && !orchestratorHalted.value)

// Khoá đại diện "cấu trúc bộ node hiện có" — đổi khi số lượng/danh tính step
// hoặc sự xuất hiện của node điều phối đổi, KHÔNG đổi khi chỉ toạ độ (drag)
// hay trạng thái (status/running) đổi. `fitView-on-init` của VueFlow chỉ chạy
// đúng 1 lần rồi khoá (`fitViewOnInitDone`) — batch đầu (trước khi SSE mang
// `pipeline` thật về) không có node điều phối, nên phải tự fit lại mỗi khi
// khoá này đổi, đúng pattern đã dùng ở PipelineEditor.vue.
const nodeStructureKey = computed(
  () => `${props.task.task_id}|${phaseKeys.value.join(',')}|${orchestratorEnabled.value}`,
)

watch(
  nodeStructureKey,
  () => {
    // setTimeout (không phải nextTick): phải đợi VueFlow tự đo dimension của
    // node vừa thêm/đổi rồi mới fitView() đúng khung — cùng độ trễ 100ms đã dùng
    // ở PipelineEditor.vue:385/666.
    setTimeout(() => fitView(), 100)
  },
  // `immediate` bắt buộc: khi `props.task.pipeline` đã đầy đủ ngay từ lần
  // render đầu (không phải luôn qua 2 batch SSE — vd state nạp thẳng từ
  // file), `nodeStructureKey` không đổi sau mount nên watch không có gì để
  // so sánh và không bao giờ tự fire nếu thiếu cờ này.
  { immediate: true },
)

// Copy có chủ đích từ PipelineEditor.vue:81 — phạm vi 1 file, chưa đủ lý do
// tách shared lib cho 3 dòng dùng ở đúng 2 nơi.
function isTaskEditable(task: any): boolean {
  return !task?.archived && task?.current_phase !== 'completed'
}
const canEditTask = computed(() => isTaskEditable(props.task))
const taskHitlPending = computed(() => Boolean(props.task.hitl_pending))

const profileSwitchOpen = ref(false)

function onAutoLayout() {
  const updated = {
    phases: phaseKeys.value.map((key, i) => ({ key, x: i * NODE_SPACING, y: NODE_Y })),
  }
  saveFlowProfile(props.task.task_id, updated).then(() => {
    customProfile.value = updated
  })
}

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
      !orchestrated.value &&
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
    const resettable =
      stateOk && !orchestrated.value && !runningStepId.value && !running && executed && !runnable
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
        // Nhãn phụ "do orchestrator điều phối" — nói rõ vì sao Run/Reset biến mất.
        orchestrated: orchestrated.value,
        // The node's Run button goes through the same confirm dialog as
        // clicking the node, so both paths share the overwrite warning.
        onRun: () => openRunConfirm({ id: p.key, label: p.label }),
        onReset: () => openResetConfirm({ id: p.key, label: p.label }),
        onStop: () => stopStep(),
      },
    }
  })
  // Node điều phối KHÔNG nằm trong `steps[]` (nó không phải một bước), nên
  // `phasesFromPipeline` / `phaseStatus` / `isRunnableTarget` không đổi một dòng.
  // Nó CÓ vẽ edge tới từng step khi bật — xem nhánh `orchestratorEnabled` của
  // `edges` computed dưới.
  const orchestratorNodes = orchestratorEnabled.value
    ? [
        {
          id: ORCHESTRATOR_NODE_ID,
          type: 'pipeline',
          draggable: false,
          position: orchestratorPositionOf(
            Object.fromEntries(phases.value.map((p) => [p.key, { x: p.x, y: p.y }])),
          ),
          data: {
            kind: 'orchestrator',
            label: t('monitor.pipeline.orchestrator'),
            taskId: props.task.task_id,
            stepId: ORCHESTRATOR_NODE_ID,
            executed: true,
            orchestratorState: orchestratorHalted.value
              ? 'halted'
              : orchestratorJobId.value
                ? 'dispatching'
                : 'listening',
            running: Boolean(orchestratorJobId.value),
            // Hai trạng thái duy nhất mà Stop có việc để làm; còn lại node hiện Run.
            orchestratorBusy: Boolean(orchestratorJobId.value) || Boolean(runningStepId.value),
            onRun: () => startOrchestratorNode(),
            onStop: () => stopOrchestratorNode(),
          },
        },
      ]
    : []

  return [...stepNodes, ...artifactGraph.value.artifactNodes, ...orchestratorNodes]
})

// Cùng điều kiện đang gate render `orchestratorNodes` ở `nodes` computed
// (không phải `orchestrated` = enabled && !halted) — node và edge của nó phải
// luôn xuất hiện/biến mất cùng nhau. Halt chỉ đổi badge/khả năng Run, không
// đổi topology hiển thị.
const edges = computed((): any[] => {
  const keys = phaseKeys.value
  const core = orchestratorEnabled.value
    ? phases.value.map((p) => {
        const isWaiting = p.hitl && props.task.hitl_pending === p.hitl
        return {
          id: `e-${ORCHESTRATOR_NODE_ID}-${p.key}`,
          source: ORCHESTRATOR_NODE_ID,
          target: p.key,
          animated: phaseStatus(p, props.task, keys) === 'active',
          label: p.hitl || '',
          labelStyle: { fill: isWaiting ? 'var(--waiting)' : 'var(--muted)', fontWeight: isWaiting ? 700 : 400 },
          style: { stroke: isWaiting ? 'var(--waiting)' : 'var(--border)', strokeWidth: 2 },
          markerEnd: { type: 'arrowclosed', color: isWaiting ? 'var(--waiting)' : 'var(--border)' },
        }
      })
    : phases.value.slice(0, -1).map((p, i) => {
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
  return [...core, ...artifactGraph.value.dataFlowEdges]
})

// Persist node positions when user drags them. Positions are keyed by phase id
// and overlaid onto the config-derived phase list.
function onNodeDragStop({ node }) {
  // Toạ độ node điều phối là phái sinh (tính từ dải step), không lưu vào flow profile.
  if (node.type === 'artifact' || isOrchestratorNode(node)) return
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
// Không preselect — người duyệt phải chủ động chọn, tránh bấm nhầm "Xác nhận"
// mà không đọc.
const hitlDecision = ref<'' | 'approve' | 'reject'>('')
const hitlBusy = ref(false)
const hitlError = ref('')
const hitlToast = ref('')

const hitlSubmitDisabled = computed(
  () =>
    hitlBusy.value ||
    hitlDecision.value === '' ||
    // Từ chối mà không ghi lý do là mất dấu vết cho lần chạy lại.
    (hitlDecision.value === 'reject' && hitlFeedback.value.trim() === ''),
)

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
  hitlDecision.value = ''
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
// Job "orchestrator đang nghĩ" — tách riêng khỏi `activeJobId` vì nó không chạy
// một step nào: gộp chung thì spinner hiện nhầm lên node `current_phase`.
const orchestratorJobId = ref<string | null>(null)
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
    const live = (j: any) =>
      j?.metadata?.taskId === props.task.task_id &&
      (j.status === 'queued' || j.status === 'running' || j.status === 'awaiting_recovery')
    orchestratorJobId.value =
      jobs.find((j: any) => live(j) && j?.metadata?.orchestratorJob === true)?.id ?? null
    const inflight = jobs.find((j: any) => live(j) && j?.metadata?.orchestratorJob !== true)
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
  orchestratorJobId.value = null
  runError.value = ''
  syncInFlightRun()
}, { immediate: true })

// Task được poll lại ở tầng trên (`hitl-action` → refetch); bám theo cả object
// `props.task` (không chỉ `state_mtime`) vì `collectTasks()` tạo object mới mỗi
// snapshot SSE — vòng đời orchestrator (dispatched/halted) đổi identity của
// `props.task` mà không nhất thiết đổi `state_mtime`, nên trạng thái node điều
// phối (listening / dispatching) không được đứng hình giữa các lượt đó.
watch(() => props.task, () => { syncInFlightRun() })

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

/**
 * Run node điều phối — xoá cờ halt và giao một lượt cho agent. Đây là đường cấp
 * lượt đầu tiên: không có nó thì pipeline bật điều phối không start được.
 */
async function startOrchestratorNode() {
  runError.value = ''
  if (props.task.state_mtime == null) {
    runError.value = t('monitor.pipeline.missingMtime')
    return
  }
  try {
    await startOrchestrator(props.task.task_id, props.task.state_mtime, props.projectId ?? undefined)
    runToast.value = t('monitor.pipeline.orchestratorStarted')
    emit('hitl-action')
    setTimeout(() => { runToast.value = '' }, 4000)
  } catch (e: any) {
    reportOrchestratorError(e)
  }
}

/** 409 ở hai nút của node điều phối luôn là `state_mtime` cũ — bảo người dùng refetch. */
function reportOrchestratorError(e: any): void {
  runError.value = e?.status === 409 ? t('monitor.pipeline.stateChanged') : String(e.message || e)
}

/**
 * Stop node điều phối — hai tầng: huỷ job quyết định đang chạy (nếu có), rồi ghi
 * `orchestrator_halted`. Bấm Run lại là giao lượt mới cho agent.
 */
async function stopOrchestratorNode() {
  runError.value = ''
  try {
    if (orchestratorJobId.value) {
      await cancelJob(orchestratorJobId.value)
      orchestratorJobId.value = null
    }
    if (props.task.state_mtime == null) {
      runError.value = t('monitor.pipeline.missingMtime')
      return
    }
    await stopOrchestrator(props.task.task_id, props.task.state_mtime, props.projectId ?? undefined)
    runToast.value = t('monitor.pipeline.orchestratorHalted')
    emit('hitl-action')
    setTimeout(() => { runToast.value = '' }, 4000)
  } catch (e: any) {
    reportOrchestratorError(e)
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
// Có step nào phía sau trong pipeline không — điều kiện hiện lựa chọn "onward"
// cho CẢ HAI nhóm. Không gate theo "step sau còn artifact": `resetScope` còn
// tác dụng ngoài việc xoá file (doc_review_round, closeTaskSession).
const resetHasLaterSteps = ref(false)
// File sẽ bị xoá, tách theo phạm vi để cảnh báo tính lại đúng theo lựa chọn.
// Bản `onward` là union của target + mọi step sau: liệt kê thiếu ở đây là cách
// người ta xoá nhầm artifact hạ nguồn mà không biết.
const resetStepFiles = ref<string[]>([])
const resetOnwardFiles = ref<string[]>([])
const resetScopeEnabled = ref(false)
const resetScope = ref<'step' | 'onward'>('step')
const deleteScopeEnabled = ref(false)
const deleteScope = ref<'step' | 'onward'>('step')
const resetError = ref('')
const resetToast = ref('')
const resetBusy = ref(false)

// Bỏ tick = về mặc định ít phá huỷ nhất: chỉ lùi đúng step, không xoá gì.
const effectiveResetScope = computed(() => (resetScopeEnabled.value ? resetScope.value : 'step'))
const effectiveDeleteScope = computed<'none' | 'step' | 'onward'>(() =>
  deleteScopeEnabled.value ? deleteScope.value : 'none',
)
const resetFilesToDelete = computed(() => {
  if (effectiveDeleteScope.value === 'none') return []
  return effectiveDeleteScope.value === 'onward' ? resetOnwardFiles.value : resetStepFiles.value
})
// Không xoá tài liệu của step mà con trỏ vẫn coi là đã chạy — cùng ràng buộc
// với `.refine` của `ResetStepRequest`.
const deleteOnwardBlocked = computed(() => effectiveResetScope.value !== 'onward')

// Hạ cấp `deleteScope` khi người dùng rút `resetScope` về 'step', nếu không
// body gửi đi vi phạm refine và nhận 400.
watch(effectiveResetScope, (v) => {
  if (v === 'step' && deleteScope.value === 'onward') deleteScope.value = 'step'
})

function openResetConfirm(node: { id: string; label: string }) {
  resetConfirmNode.value = node
  const keys = phaseKeys.value
  const idx = keys.indexOf(node.id)
  const afterKeys = idx >= 0 ? keys.slice(idx + 1) : []
  resetHasLaterSteps.value = afterKeys.length > 0
  resetStepFiles.value = stepProduces(node.id).filter((f) => props.task.artifacts?.[f]?.exists)
  resetOnwardFiles.value = Array.from(
    new Set(
      [node.id, ...afterKeys].flatMap((k) =>
        stepProduces(k).filter((f) => props.task.artifacts?.[f]?.exists),
      ),
    ),
  )
  resetScopeEnabled.value = false
  resetScope.value = 'step'
  deleteScopeEnabled.value = false
  deleteScope.value = 'step'
  resetError.value = ''
  resetConfirmOpen.value = true
}

function cancelResetConfirm() {
  resetConfirmOpen.value = false
  resetConfirmNode.value = null
  resetHasLaterSteps.value = false
  resetStepFiles.value = []
  resetOnwardFiles.value = []
  resetScopeEnabled.value = false
  deleteScopeEnabled.value = false
}

async function doResetStep(
  node: { id: string; label: string },
  scopes: { resetScope: 'step' | 'onward'; deleteScope: 'none' | 'step' | 'onward' },
) {
  resetBusy.value = true
  resetError.value = ''
  try {
    await resetPipelineStep(
      props.task.task_id,
      { stepId: node.id, ...scopes },
      props.projectId ?? undefined,
    )
    // Đóng dialog CHỈ khi request đã thành công — đối xứng `submitHitl`. Đóng
    // trước là ném mất hai nhóm phạm vi vừa tick khi server trả 409.
    cancelResetConfirm()
    resetToast.value = t('monitor.pipeline.resetDone')
    emit('hitl-action')
    setTimeout(() => { resetToast.value = '' }, 3000)
  } catch (e: any) {
    if (e?.status === 409) {
      resetError.value = t('monitor.pipeline.stepAlreadyRunning')
    } else {
      resetError.value = String(e.message || e)
    }
  } finally {
    resetBusy.value = false
  }
}

function confirmReset() {
  const node = resetConfirmNode.value
  if (!node || resetBusy.value) return
  doResetStep(node, {
    resetScope: effectiveResetScope.value,
    deleteScope: effectiveDeleteScope.value,
  })
}

function onNodeClick({ node }) {
  if (node.type === 'artifact') return
  // Node điều phối không chạy bằng click — nó chỉ có chat + stop.
  if (isOrchestratorNode(node)) return
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

async function submitHitl() {
  const action = hitlDecision.value
  if (action === '') return
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
        feedback: action === 'reject' ? hitlFeedback.value.trim() : undefined,
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
      <div v-if="canEditTask" class="canvas-corner-actions">
        <button
          type="button"
          class="icon-btn"
          :title="t('monitor.pipeline.autoLayout')"
          :aria-label="t('monitor.pipeline.autoLayout')"
          @click="onAutoLayout"
        >
          <Icon name="layout" />
        </button>
        <button
          type="button"
          class="icon-btn"
          :title="t('monitor.pipeline.switchProfile')"
          :aria-label="t('monitor.pipeline.switchProfile')"
          @click="profileSwitchOpen = true"
        >
          <Icon name="swap" />
        </button>
      </div>
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

  <ProfileSwitchDialog
    v-if="profileSwitchOpen"
    :task-id="task.task_id"
    :project-id="projectId"
    :hitl-pending="taskHitlPending"
    @close="profileSwitchOpen = false"
    @applied="profileSwitchOpen = false; emit('hitl-action')"
  />

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
          <div class="cfg-choices">
            <label class="cfg-choice">
              <input v-model="hitlDecision" type="radio" name="hitl-decision" value="approve" />
              <span>{{ t('monitor.pipeline.decisionApprove') }}</span>
            </label>
            <label class="cfg-choice">
              <input v-model="hitlDecision" type="radio" name="hitl-decision" value="reject" />
              <span>{{ t('monitor.pipeline.decisionReject') }}</span>
            </label>
          </div>
          <label v-if="hitlDecision === 'reject'" class="cfg-label">
            {{ t('monitor.pipeline.feedbackLabel') }}
            <textarea v-model="hitlFeedback" class="cfg-textarea" rows="4" />
          </label>
          <p v-if="hitlError" class="editor-error">{{ hitlError }}</p>
        </div>
        <div class="modal-actions">
          <button class="btn-ghost" :disabled="hitlBusy" @click="hitlOpen = false">
            {{ t('monitor.pipeline.cancel') }}
          </button>
          <button class="btn-primary" :disabled="hitlSubmitDisabled" @click="submitHitl()">
            {{ hitlBusy ? t('monitor.pipeline.saving') : t('monitor.pipeline.confirm') }}
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
          <p class="modal-hint">
            {{ t('monitor.pipeline.resetConfirmBody', { label: resetConfirmNode?.label ?? '' }) }}
          </p>

          <label class="cfg-label cfg-label-row">
            <input v-model="resetScopeEnabled" type="checkbox" />
            {{ t('monitor.pipeline.resetScopeToggle') }}
          </label>
          <div v-if="resetScopeEnabled" class="cfg-choices cfg-choices-nested">
            <label class="cfg-choice">
              <input v-model="resetScope" type="radio" name="reset-scope" value="step" />
              <span>{{ t('monitor.pipeline.resetScopeStep') }}</span>
            </label>
            <label v-if="resetHasLaterSteps" class="cfg-choice">
              <input v-model="resetScope" type="radio" name="reset-scope" value="onward" />
              <span>{{ t('monitor.pipeline.resetScopeOnward') }}</span>
            </label>
          </div>

          <label class="cfg-label cfg-label-row">
            <input v-model="deleteScopeEnabled" type="checkbox" />
            {{ t('monitor.pipeline.deleteScopeToggle') }}
          </label>
          <div v-if="deleteScopeEnabled" class="cfg-choices cfg-choices-nested">
            <label class="cfg-choice">
              <input v-model="deleteScope" type="radio" name="delete-scope" value="step" />
              <span>{{ t('monitor.pipeline.deleteScopeStep') }}</span>
            </label>
            <label v-if="resetHasLaterSteps" class="cfg-choice">
              <input
                v-model="deleteScope"
                type="radio"
                name="delete-scope"
                value="onward"
                :disabled="deleteOnwardBlocked"
              />
              <span>{{ t('monitor.pipeline.deleteScopeOnward') }}</span>
            </label>
            <p v-if="resetHasLaterSteps && deleteOnwardBlocked" class="modal-hint">
              {{ t('monitor.pipeline.deleteScopeOnwardBlocked') }}
            </p>
          </div>

          <p v-if="resetFilesToDelete.length" class="editor-error">
            {{ t('monitor.pipeline.resetConfirmDeleteWarning', { files: resetFilesToDelete.join(', ') }) }}
          </p>
          <p v-if="resetError" class="editor-error">{{ resetError }}</p>
        </div>
        <div class="modal-actions">
          <button class="btn-ghost" :disabled="resetBusy" @click="cancelResetConfirm">
            {{ t('monitor.pipeline.cancel') }}
          </button>
          <button class="btn-primary" :disabled="resetBusy" @click="confirmReset()">
            {{ resetBusy ? t('monitor.pipeline.saving') : t('monitor.pipeline.resetSubmit') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.pipeline-wrap { margin-bottom: 14px; }

.vflow-container { position: relative; }
.canvas-corner-actions {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 5;
  display: flex;
  gap: 4px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
}
.vflow-container:hover .canvas-corner-actions,
.vflow-container:focus-within .canvas-corner-actions {
  opacity: 1;
  pointer-events: auto;
}

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

/* Nhóm radio/checkbox trong dialog — giữ cục bộ theo tiền lệ `.cfg-label-row`
   của StepConfigDialog.vue; mới hai nơi dùng, chưa đủ lý do nâng lên shell. */
.cfg-choices { display: flex; flex-direction: column; gap: 6px; }
.cfg-choices-nested { margin-left: 22px; }
.cfg-choice {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  cursor: pointer;
}
.cfg-choice input[type='radio'] { margin-top: 2px; }
.cfg-choice input[type='radio']:disabled { cursor: not-allowed; }
.cfg-choice input[type='radio']:disabled + span { color: var(--muted); cursor: not-allowed; }
.cfg-label-row { flex-direction: row; align-items: center; gap: 6px; cursor: pointer; }
</style>
