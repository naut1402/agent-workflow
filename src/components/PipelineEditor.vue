<script setup>
import { ref, computed, markRaw, onMounted, watch } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'
import { fetchCatalog, fetchPipelineConfig, fetchRules, writePipelineConfig } from '../api.js'
import { useLocalToggle } from '../lib/useLocalToggle.js'
import PipelineEditorNode from './PipelineEditorNode.vue'
import CatalogPanel from './CatalogPanel.vue'
import RulesPanel from './RulesPanel.vue'
import StepConfigPanel from './StepConfigPanel.vue'
import ProfileManager from './ProfileManager.vue'
import RailIcon from './RailIcon.vue'

const props = defineProps({
  scope: { type: String, default: 'global' },
  taskId: { type: String, default: '' },
  appSidebarCollapsed: { type: Boolean, default: false },
})

const nodeTypes = { pipelineEditor: markRaw(PipelineEditorNode) }
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

const catalog = ref({ skills: [], agents: [] })
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
    catalog.value = await fetchCatalog()
  } catch {
    catalog.value = { skills: [], agents: [], error: true }
  }
}

async function loadRules() {
  try {
    rulesData.value = await fetchRules()
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

async function loadConfig() {
  try {
    const data = await fetchPipelineConfig(props.scope === 'task' ? props.taskId : null)
    buildFlowFromPipeline(data.pipeline)
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
  addEdges([{ ...params, markerEnd: { type: 'arrowclosed' } }])
})

onMounted(async () => {
  await Promise.all([loadCatalog(), loadRules(), loadConfig()])
  setTimeout(() => fitView(), 100)
})

let configDebounce = null
watch(
  [() => props.scope, () => props.taskId],
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

function buildPipelineFromFlow() {
  const nodeList = getNodes.value
  const edgeList = getEdges.value
  const order = topoSort(nodeList, edgeList)
  const nodeMap = Object.fromEntries(nodeList.map((n) => [n.id, n]))
  const steps = order.map((id) => {
    const n = nodeMap[id]
    if (!n) return null
    const d = n.data
    return {
      id,
      name: d.label || id,
      agent: d.agent || '',
      skills: d.skills || [],
      rule_category: d.rule_category || '',
      rule_required: d.rule_required ?? true,
      produces: d.produces || [],
      knowledge_inputs: d.knowledge_inputs || [],
      hitl: d.hitl || { mode: 'none' },
    }
  }).filter(Boolean)
  return { version: 1, steps }
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
  saving.value = true
  saveMsg.value = ''
  try {
    const pipeline = buildPipelineFromFlow()
    await writePipelineConfig(props.scope, pipeline, props.taskId || undefined)
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
  buildFlowFromPipeline(pipeline)
  setTimeout(() => fitView(), 100)
}

const currentPipeline = computed(() => buildPipelineFromFlow())
const currentSteps = computed(() => currentPipeline.value.steps || [])

const hasFanOut = computed(() => {
  const outDeg = {}
  for (const e of getEdges.value) {
    outDeg[e.source] = (outDeg[e.source] || 0) + 1
  }
  return Object.values(outDeg).some((d) => d > 1)
})

const editorLayoutClass = computed(() => ({
  'editor-layout--left-collapsed': editorLeftCollapsed.value,
  'editor-layout--no-config': !selectedNodeId.value,
}))
</script>

<template>
  <div class="editor-root" :class="{ 'preview-active': previewing }">
    <div class="editor-toolbar">
      <ProfileManager :current-pipeline="currentPipeline" @load="onProfileLoad" />

      <div v-if="hasFanOut" class="fanout-warning" role="status">
        Orchestrator chạy tuần tự — nhánh song song sẽ được sắp xếp theo thứ tự topo khi lưu
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
          :disabled="saving"
          @click="saveToFile"
        >{{ saving ? 'Saving…' : 'Save to file' }}</button>
        <span v-if="saveMsg" class="save-msg">{{ saveMsg }}</span>
      </div>
    </div>

    <div class="editor-layout" :class="editorLayoutClass">
      <div class="editor-left" :class="{ 'editor-left-collapsed': editorLeftCollapsed }">
        <div class="editor-left-tabs" :class="{ 'is-collapsed': editorLeftCollapsed }">
          <button
            type="button"
            class="editor-left-collapse-btn rail-icon-btn"
            :title="editorLeftCollapsed ? 'Mở catalog & rules' : 'Thu gọn catalog'"
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
              title="Catalog — mở panel"
              @click="openLeftTab('catalog')"
            >
              <RailIcon name="catalog" />
            </button>
            <button
              class="editor-left-tab editor-left-tab-icon rail-icon-btn"
              :class="{ active: leftTab === 'rules' }"
              title="Rules — mở panel"
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
            <span v-if="previewHitlPause" class="preview-banner-hitl">— chờ HITL</span>
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
