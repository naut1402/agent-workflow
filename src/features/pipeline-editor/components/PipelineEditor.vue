<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { ref, computed, markRaw, onMounted, watch } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'
import { fetchCatalog, fetchPipelineConfig, fetchRules, writePipelineConfig } from '../scripts/pipelineEditorApi'
import { useLocalToggle } from '../../../core/composables/useLocalToggle'
import PipelineEditorNode from './PipelineEditorNode.vue'
import CatalogPanel from './CatalogPanel.vue'
import RulesPanel from './RulesPanel.vue'
import StepConfigPanel from './StepConfigPanel.vue'
import ProfileManager from './ProfileManager.vue'
import RailIcon from '../../../core/ui/RailIcon.vue'
import { taskDisplayName } from '../../monitor/lib/taskDisplay'
import {
  extractPipelineMeta,
  extractStepPreservedMap,
  buildStepFromNode,
  assemblePipeline,
  type PipelineMeta,
  type StepPreservedMap,
} from '../lib/pipelineRoundTrip'

const { t } = useI18nHelpers()

const props = defineProps({
  scope: { type: String, default: 'global' },
  taskId: { type: String, default: '' },
  tasks: { type: Array as () => any[], default: () => [] },
  projectId: { type: [String, null], default: null },
  appSidebarCollapsed: { type: Boolean, default: false },
})

const emit = defineEmits(['update:scope', 'update:task-id'])

const taskSelect = ref('')
const taskManual = ref('')

/** Per-task pipeline edits only make sense for in-flight tasks. */
function isTaskEditable(task: any): boolean {
  return !task?.archived && task?.current_phase !== 'completed'
}

const editableTasks = computed(() =>
  (props.tasks || []).filter((t: any) => isTaskEditable(t)),
)

/** True when the open task is archived/completed (known from props). */
const taskWriteBlocked = computed(() => {
  if (props.scope !== 'task') return false
  const id = (props.taskId || '').trim()
  if (!id) return true
  const known = (props.tasks || []).find((t: any) => t.task_id === id)
  return !!(known && !isTaskEditable(known))
})

function onScopeChange(event) {
  emit('update:scope', event.target.value)
}

function onTaskSelectChange() {
  if (taskSelect.value === '__manual__') {
    emit('update:task-id', taskManual.value)
  } else {
    emit('update:task-id', taskSelect.value)
    taskManual.value = ''
  }
}

watch(taskManual, (v) => {
  if (taskSelect.value === '__manual__') emit('update:task-id', v)
})

watch(
  () => props.taskId,
  (id) => {
    if (!id) {
      if (props.scope !== 'global') {
        taskSelect.value = ''
        taskManual.value = ''
      }
      return
    }
    const listed = editableTasks.value.some((t: any) => t.task_id === id)
    if (listed) {
      taskSelect.value = id
      taskManual.value = ''
      return
    }
    const known = (props.tasks || []).find((t: any) => t.task_id === id)
    if (known && !isTaskEditable(known)) {
      // Do not fall through to manual entry — that would bypass the filter.
      taskSelect.value = ''
      taskManual.value = ''
      emit('update:task-id', '')
      return
    }
    taskSelect.value = '__manual__'
    taskManual.value = id
  },
  { immediate: true },
)

watch(
  () => props.scope,
  (scope) => {
    if (scope === 'global') {
      taskSelect.value = ''
      taskManual.value = ''
      emit('update:task-id', '')
    }
  },
)

const nodeTypes = { pipelineEditor: markRaw(PipelineEditorNode) } as any
const {
  setNodes,
  setEdges,
  addEdges,
  removeNodes,
  getNodes,
  getEdges,
  onConnect,
  fitView,
  screenToFlowCoordinate,
} = useVueFlow()

const nodes = ref([])
const edges = ref([])

const pipelineMeta = ref<PipelineMeta>({})
const stepPreserved = ref<StepPreservedMap>({})
const catalog = ref<any>({ skills: [], agents: [] })
const rulesData = ref({ rules: [], categories: [] })
const leftTab = ref('catalog')
const highlightedCategory = ref(null)
const { state: editorLeftCollapsed, toggle: toggleEditorLeft, setFalse: expandEditorLeft } = useLocalToggle(false)

function openLeftTab(tab) {
  leftTab.value = tab
  expandEditorLeft()
}

async function loadCatalog() {
  try {
    catalog.value = await fetchCatalog(props.projectId ?? undefined)
  } catch {
    catalog.value = { skills: [], agents: [], error: true } as any
  }
}

async function loadRules() {
  try {
    rulesData.value = await fetchRules(props.projectId ?? undefined)
  } catch {
    rulesData.value = { rules: [], categories: [] }
  }
}

function nodeMatchesHighlight(nodeData) {
  if (!highlightedCategory.value) return false
  const rc = nodeData?.rule_category
  if (!rc) return false
  if (Array.isArray(rc)) return rc.includes(highlightedCategory.value)
  return rc === highlightedCategory.value
}

function onRuleSelect(rule) {
  highlightedCategory.value =
    highlightedCategory.value === rule.category ? null : rule.category
}

function applyLoadedPipeline(pipeline) {
  pipelineMeta.value = extractPipelineMeta(pipeline)
  stepPreserved.value = extractStepPreservedMap(pipeline?.steps || [])
  buildFlowFromPipeline(pipeline)
}

async function loadConfig() {
  try {
    const data = await fetchPipelineConfig(
      props.scope === 'task' ? props.taskId : null,
      props.projectId ?? undefined,
    )
    applyLoadedPipeline(data.pipeline)
  } catch {
    // no-op
  }
}

function buildFlowFromPipeline(pipeline) {
  closeConfig()
  const steps = pipeline?.steps || []
  const newNodes = steps.map((step, i) => ({
    id: step.id,
    type: 'pipelineEditor',
    position: { x: 20 + i * 220, y: 60 },
    data: {
      label: step.name || step.id,
      agent: step.agent || '',
      skills: Array.isArray(step.skills) ? step.skills : [],
      rule_category: step.rule_category || '',
      rule_required: step.rule_required ?? true,
      produces: Array.isArray(step.produces) ? step.produces : [],
      knowledge_inputs: Array.isArray(step.knowledge_inputs) ? step.knowledge_inputs : [],
      hitl: step.hitl || { mode: 'none' },
    },
  }))

  const newEdges = steps.slice(0, -1).map((step, i) => ({
    id: `e-${step.id}-${steps[i + 1].id}`,
    source: step.id,
    target: steps[i + 1].id,
    markerEnd: { type: 'arrowclosed' },
  }))

  setNodes(newNodes)
  setEdges(newEdges)
  nodeCounter = steps.length
}

onConnect((params) => {
  addEdges([{ ...params, markerEnd: { type: 'arrowclosed' } }] as any)
})

onMounted(async () => {
  await Promise.all([loadCatalog(), loadRules(), loadConfig()])
  setTimeout(() => fitView(), 100)
})

watch(() => props.projectId, () => {
  loadCatalog()
  loadRules()
})

let configDebounce = null
watch(
  [() => props.scope, () => props.taskId, () => props.projectId],
  () => {
    closeConfig()
    clearTimeout(configDebounce)
    if (props.scope === 'global') {
      loadConfig()
      return
    }
    if (!props.taskId?.trim()) {
      setNodes([])
      setEdges([])
      nodeCounter = 0
      return
    }
    configDebounce = setTimeout(() => loadConfig(), 300)
  },
)

const canvasRef = ref(null)
let nodeCounter = 0

function onDragOver(event) {
  event.preventDefault()
  event.dataTransfer.dropEffect = 'copy'
}

function onDropOnCanvas(event) {
  event.preventDefault()
  let item
  try {
    item = JSON.parse(event.dataTransfer.getData('application/json'))
  } catch {
    return
  }

  const pos = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })

  const id = `step-${item.name}-${++nodeCounter}`
  const newNode = {
    id,
    type: 'pipelineEditor',
    position: { x: pos.x - 60, y: pos.y - 25 },
    data: {
      label: item.name,
      agent: item._type === 'agent' ? item.id : '',
      skills: item._type === 'agent' ? (item.skills || []) : [item.name],
      rule_category: '',
      rule_required: true,
      produces: [],
      knowledge_inputs: [],
      hitl: { mode: 'none' },
    },
  }
  setNodes([...getNodes.value, newNode])
}

const selectedNodeId = ref(null)
const selectedNodeData = ref(null)

function openConfig(nodeId, data) {
  selectedNodeId.value = nodeId
  selectedNodeData.value = { ...data }
}

function closeConfig() {
  selectedNodeId.value = null
  selectedNodeData.value = null
}

function onPaneClick() {
  closeConfig()
}

function applyStepUpdate(nodeId, updatedData) {
  nodes.value = nodes.value.map((n) =>
    n.id === nodeId ? { ...n, data: { ...n.data, ...updatedData } } : n,
  )
  closeConfig()
}

function deleteNode(nodeId) {
  removeNodes([nodeId])
  if (selectedNodeId.value === nodeId) closeConfig()
}

function topoSort(nodeList, edgeList) {
  const adj = {}
  const inDeg = {}
  for (const n of nodeList) { adj[n.id] = []; inDeg[n.id] = 0 }
  for (const e of edgeList) {
    adj[e.source].push(e.target)
    inDeg[e.target] = (inDeg[e.target] || 0) + 1
  }
  const queue = nodeList.filter((n) => inDeg[n.id] === 0).map((n) => n.id)
  const sorted = []
  while (queue.length) {
    const id = queue.shift()
    sorted.push(id)
    for (const next of adj[id]) {
      inDeg[next]--
      if (inDeg[next] === 0) queue.push(next)
    }
  }
  const remaining = nodeList.filter((n) => !sorted.includes(n.id)).sort((a, b) => a.position.x - b.position.x)
  return [...sorted, ...remaining.map((n) => n.id)]
}

const previewOrder = computed(() => topoSort(getNodes.value, getEdges.value))

function getPreviewState(nodeId) {
  if (!previewing.value || !previewNodeId.value) {
    if (previewing.value) return 'pending'
    return 'idle'
  }
  const order = previewOrder.value
  const activeIdx = order.indexOf(previewNodeId.value)
  const nodeIdx = order.indexOf(nodeId)
  if (nodeIdx < 0) return 'idle'
  if (nodeIdx < activeIdx) return 'done'
  if (nodeId === previewNodeId.value) {
    return previewHitlPause.value ? 'hitl' : 'active'
  }
  return 'pending'
}

const previewActiveStep = computed(() => {
  if (!previewing.value || !previewNodeId.value) return null
  const node = getNodes.value.find((n) => n.id === previewNodeId.value)
  if (!node) return null
  const idx = previewOrder.value.indexOf(previewNodeId.value)
  return {
    index: idx + 1,
    total: previewOrder.value.length,
    label: node.data?.label || previewNodeId.value,
    agent: node.data?.agent || '',
  }
})

function buildFullPipeline() {
  const nodeList = getNodes.value
  const edgeList = getEdges.value
  const order = topoSort(nodeList, edgeList)
  const nodeMap = Object.fromEntries(nodeList.map((n) => [n.id, n]))
  const steps = order
    .map((id) => {
      const n = nodeMap[id]
      if (!n) return null
      return buildStepFromNode(n.data, id, stepPreserved.value[id])
    })
    .filter(Boolean)
  return assemblePipeline(pipelineMeta.value, steps as Record<string, unknown>[])
}

function autoLayout() {
  const nodeList = getNodes.value
  const edgeList = getEdges.value
  const order = topoSort(nodeList, edgeList)
  setNodes(nodeList.map((n) => {
    const idx = order.indexOf(n.id)
    return { ...n, position: { x: 20 + Math.max(0, idx) * 220, y: 60 } }
  }))
  setTimeout(() => fitView(), 50)
}

const saving = ref(false)
const saveMsg = ref('')

async function saveToFile() {
  if (taskWriteBlocked.value) {
    saveMsg.value = '✗ Task is archived or completed'
    return
  }
  saving.value = true
  saveMsg.value = ''
  try {
    const pipeline = buildFullPipeline()
    await writePipelineConfig(
      props.scope,
      pipeline,
      props.taskId || undefined,
      props.projectId ?? undefined,
    )
    saveMsg.value = '✓ Saved'
    setTimeout(() => { saveMsg.value = '' }, 2500)
  } catch (e) {
    saveMsg.value = `✗ ${e.message}`
  } finally {
    saving.value = false
  }
}

const { state: previewing, setTrue: startPreview, setFalse: stopPreview } = useLocalToggle(false)
const previewNodeId = ref(null)
const previewHitlPause = ref(false)
let previewTimer = null

async function runPreview() {
  if (previewing.value) return
  closeConfig()
  startPreview()
  const order = topoSort(getNodes.value, getEdges.value)
  previewNodeId.value = null
  previewHitlPause.value = false

  for (const id of order) {
    if (!previewing.value) break
    previewNodeId.value = id
    previewHitlPause.value = false
    await sleep(600)
    if (!previewing.value) break
    const node = getNodes.value.find((n) => n.id === id)
    const hitlMode = node?.data?.hitl?.mode
    if (hitlMode && hitlMode !== 'none') {
      previewHitlPause.value = true
      await sleep(1200)
      previewHitlPause.value = false
    }
  }
  previewNodeId.value = null
  previewHitlPause.value = false
  stopPreview()
}

function stopDemo() {
  clearTimeout(previewTimer)
  stopPreview()
  previewNodeId.value = null
  previewHitlPause.value = false
}

function sleep(ms) {
  return new Promise((res) => { previewTimer = setTimeout(res, ms) })
}

function onProfileLoad(pipeline) {
  applyLoadedPipeline(pipeline)
  setTimeout(() => fitView(), 100)
}

const currentPipeline = computed(() => buildFullPipeline())
const currentSteps = computed(() => {
  const steps = currentPipeline.value.steps
  return Array.isArray(steps) ? steps : []
})

const hasFanOut = computed(() => {
  const outDeg = {}
  for (const e of getEdges.value) {
    outDeg[e.source] = (outDeg[e.source] || 0) + 1
  }
  return Object.values(outDeg).some((d: any) => d > 1)
})

const editorLayoutClass = computed(() => ({
  'editor-layout--left-collapsed': editorLeftCollapsed.value,
  'editor-layout--no-config': !selectedNodeId.value,
}))
</script>

<template>
  <div class="editor-root" :class="{ 'preview-active': previewing }">
    <div class="editor-toolbar">
      <ProfileManager
        :current-pipeline="currentPipeline"
        :project-id="projectId"
        @load="onProfileLoad"
      />

      <div v-if="hasFanOut" class="fanout-warning" role="status">
        {{ t('pipelineEditor.toolbar.fanOutWarning') }}
      </div>

      <div class="editor-toolbar-actions">
        <button class="btn-ghost btn-sm" @click="autoLayout">Auto-layout</button>
        <button
          v-if="!previewing"
          class="btn-ghost btn-sm"
          @click="runPreview"
        >▶ Preview</button>
        <button
          v-else
          class="btn-danger btn-sm"
          @click="stopDemo"
        >■ Stop</button>
        <button
          class="btn-primary btn-sm"
          :disabled="saving || taskWriteBlocked"
          @click="saveToFile"
        >{{ saving ? 'Saving…' : 'Save to file' }}</button>
        <span v-if="saveMsg" class="save-msg">{{ saveMsg }}</span>
      </div>
    </div>

    <div class="editor-layout" :class="editorLayoutClass">
      <div class="editor-left" :class="{ 'editor-left-collapsed': editorLeftCollapsed }">
        <div v-if="!editorLeftCollapsed" class="editor-scope-panel">
          <label class="scope-label">Scope:</label>
          <select :value="scope" class="scope-select cfg-input" @change="onScopeChange">
            <option value="global">Global pipeline.yaml</option>
            <option value="task">Per-task</option>
          </select>
          <template v-if="scope === 'task'">
            <select
              v-model="taskSelect"
              class="scope-select cfg-input"
              @change="onTaskSelectChange"
            >
              <option value="">{{ t('pipelineEditor.scope.selectTask') }}</option>
              <option v-for="task in editableTasks" :key="task.task_id" :value="task.task_id">
                {{ taskDisplayName(task) }}
              </option>
              <option value="__manual__">{{ t('pipelineEditor.scope.manualEntry') }}</option>
            </select>
            <input
              v-if="taskSelect === '__manual__'"
              v-model="taskManual"
              class="scope-task-input cfg-input"
              :placeholder="t('pipelineEditor.scope.taskIdPlaceholder')"
            />
          </template>
        </div>
        <div class="editor-left-tabs" :class="{ 'is-collapsed': editorLeftCollapsed }">
          <button
            type="button"
            class="editor-left-collapse-btn rail-icon-btn"
            :title="editorLeftCollapsed ? t('pipelineEditor.leftPanel.expandTitle') : t('pipelineEditor.leftPanel.collapseTitle')"
            :aria-expanded="!editorLeftCollapsed"
            @click="toggleEditorLeft"
          >
            <RailIcon :name="editorLeftCollapsed ? 'panelExpand' : 'panelCollapse'" />
          </button>
          <template v-if="!editorLeftCollapsed">
            <button
              class="editor-left-tab"
              :class="{ active: leftTab === 'catalog' }"
              @click="leftTab = 'catalog'"
            >
              <RailIcon name="catalog" :size="14" />
              <span>Catalog</span>
            </button>
            <button
              class="editor-left-tab"
              :class="{ active: leftTab === 'rules' }"
              @click="leftTab = 'rules'"
            >
              <RailIcon name="rules" :size="14" />
              <span>Rules</span>
            </button>
          </template>
          <template v-else>
            <button
              class="editor-left-tab editor-left-tab-icon rail-icon-btn"
              :class="{ active: leftTab === 'catalog' }"
              :title="t('pipelineEditor.leftPanel.catalogOpenTitle')"
              @click="openLeftTab('catalog')"
            >
              <RailIcon name="catalog" />
            </button>
            <button
              class="editor-left-tab editor-left-tab-icon rail-icon-btn"
              :class="{ active: leftTab === 'rules' }"
              :title="t('pipelineEditor.leftPanel.rulesOpenTitle')"
              @click="openLeftTab('rules')"
            >
              <RailIcon name="rules" />
            </button>
          </template>
        </div>
        <CatalogPanel v-if="leftTab === 'catalog' && !editorLeftCollapsed" :catalog="catalog" />
        <RulesPanel
          v-else-if="leftTab === 'rules' && !editorLeftCollapsed"
          :rules="rulesData.rules"
          :categories="rulesData.categories"
          :steps="currentSteps"
          :highlighted-category="highlightedCategory"
          @select-rule="onRuleSelect"
        />
      </div>

      <div
        class="vflow-container editor-canvas"
        ref="canvasRef"
        @dragover="onDragOver"
        @drop="onDropOnCanvas"
      >
        <VueFlow
          v-model:nodes="nodes"
          v-model:edges="edges"
          :node-types="nodeTypes"
          fit-view-on-init
          :zoom-on-scroll="false"
          :pan-on-drag="true"
          :nodes-draggable="!previewing"
          :nodes-connectable="!previewing"
          :elements-selectable="true"
          class="vflow"
          @pane-click="onPaneClick"
        >
          <template #node-pipelineEditor="nodeProps">
            <PipelineEditorNode
              v-bind="nodeProps"
              :preview-state="getPreviewState(nodeProps.id)"
              :class="{
                'node-rule-highlight': nodeMatchesHighlight(nodeProps.data),
              }"
              @edit="openConfig"
              @delete="deleteNode"
            />
          </template>
        </VueFlow>

        <div v-if="previewing" class="preview-banner">
          <template v-if="previewActiveStep">
            <strong>{{ previewActiveStep.index }}/{{ previewActiveStep.total }}</strong>
            {{ previewActiveStep.label }}
            <span v-if="previewActiveStep.agent" class="preview-banner-agent">({{ previewActiveStep.agent }})</span>
            <span v-if="previewHitlPause" class="preview-banner-hitl">{{ t('pipelineEditor.preview.waitingHitl') }}</span>
          </template>
          <template v-else>Simulation — no files written</template>
          &nbsp;
          <button class="btn-danger btn-xs" @click="stopDemo">Stop</button>
        </div>
      </div>

      <StepConfigPanel
        v-if="selectedNodeId"
        :step-id="selectedNodeId"
        :step="selectedNodeData"
        :catalog="catalog"
        :rule-categories="rulesData.categories"
        @update="applyStepUpdate"
        @close="closeConfig"
      />
    </div>
  </div>
</template>

<style scoped lang="scss">
.scope-label { font-size: 11px; color: var(--muted); }
.scope-select, .scope-task-input {
  background: var(--panel-2);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 5px;
  padding: 4px 7px;
  font-size: 12px;
  font-family: inherit;
}
.scope-task-input { margin-top: 3px; }
.editor-scope-panel {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
/* ── Editor root & layout ───────────────────────────────────────────────── */
.editor-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.editor-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.editor-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.fanout-warning {
  flex: 1;
  min-width: 200px;
  max-width: 480px;
  padding: 4px 10px;
  font-size: 11px;
  line-height: 1.35;
  color: var(--waiting, #b8860b);
  background: rgba(184, 134, 11, 0.12);
  border: 1px solid rgba(184, 134, 11, 0.35);
  border-radius: 4px;
}
.editor-layout {
  display: grid;
  grid-template-columns: 240px 1fr 280px;
  flex: 1;
  overflow: hidden;
  isolation: isolate;
  transition: grid-template-columns 0.2s ease;
}
.editor-layout.editor-layout--left-collapsed {
  grid-template-columns: 48px 1fr 280px;
}
.editor-layout.editor-layout--no-config {
  grid-template-columns: 240px 1fr;
}
.editor-layout.editor-layout--left-collapsed.editor-layout--no-config {
  grid-template-columns: 48px 1fr;
}

.editor-canvas {
  position: relative;
  overflow: hidden;
  height: 100%;
}
.editor-canvas .vflow-container {
  height: 100%;
  border-radius: 0;
  border: none;
  border-left: 1px solid var(--border);
}

.preview-active .editor-toolbar { opacity: 0.6; pointer-events: none; }
.preview-active .editor-left { opacity: 0.5; pointer-events: none; }

.preview-banner {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(14, 18, 24, 0.92);
  border: 1px solid var(--waiting);
  color: var(--text);
  border-radius: 20px;
  padding: 6px 16px;
  font-size: 13px;
  z-index: 10;
  white-space: nowrap;
  max-width: 90%;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}
.preview-banner-agent { color: var(--muted); font-size: 11px; }
.preview-banner-hitl { color: var(--waiting); font-weight: 600; }

/* ── Editor left column (catalog + rules tabs) ───────────────────────────── */
.editor-left {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--panel);
  border-right: 1px solid var(--border);
  transition: width 0.2s ease;
  min-width: 0;
}
.editor-left.editor-left-collapsed {
  width: 48px;
  min-width: 48px;
}

.editor-left-tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  align-items: stretch;
}
.editor-left-tabs.is-collapsed {
  flex-direction: column;
  border-bottom: none;
  gap: 6px;
  padding: 6px;
  align-items: center;
  width: 100%;
  box-sizing: border-box;
}
.editor-left-collapse-btn {
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--muted);
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  cursor: pointer;
  padding: 0;
  font-family: inherit;
  margin: 0;
}
.editor-left-tabs.is-collapsed .editor-left-collapse-btn {
  margin: 0;
}
.editor-left-collapse-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: rgba(var(--accent-rgb), 0.08);
}
.editor-left-tab {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--muted);
  padding: 8px 6px;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}
.editor-left-tab-icon {
  width: 36px;
  height: 36px;
  flex: none;
  margin: 0;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--panel-2);
  padding: 0 !important;
}
.editor-left-tab-icon.active {
  color: var(--accent);
  border-color: var(--accent);
  background: rgba(var(--accent-rgb), 0.1);
}
.editor-left-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.editor-left-tab:hover:not(.active) { color: var(--text); }
</style>
