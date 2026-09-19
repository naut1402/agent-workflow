<script setup lang="ts">
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'
import { ref, computed, markRaw, onMounted, watch } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'
import {
  fetchCatalog,
  fetchCatalogAgent,
  fetchPipelineConfig,
  fetchRuleContent,
  fetchRules,
  fetchSkillContent,
  writePipelineConfig,
} from '../scripts/pipelineEditorApi'
import CMarkdownView from '../../../frontend/ui/CMarkdownView.vue'
import { useLocalToggle } from '../../../frontend/composables/useLocalToggle'
import PipelineEditorNode from './PipelineEditorNode.vue'
import CatalogPanel from './CatalogPanel.vue'
import RulesPanel from './RulesPanel.vue'
import StepConfigDialog from './StepConfigDialog.vue'
import EditorTargetPanel from './EditorTargetPanel.vue'
import OrchestratorNode from './OrchestratorNode.vue'
import ArtifactNode from '../../../frontend/ui/ArtifactNode.vue'
import CScreenLayout from '../../../frontend/ui/CScreenLayout.vue'
import { usePipelineProfiles } from '../composables/usePipelineProfiles'
import {
  buildEditorGraph,
  derivedNodesOf,
  hasRemovalChange,
  stepEdgesOf,
  stepNodesOf,
} from '../lib/canvasGraph'
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
  /** v-model từ shell — mode icon trên rail sidebar là control ẩn/hiện panel trái. */
  subSidebarCollapsed: { type: Boolean, default: false },
})

const emit = defineEmits(['update:scope', 'update:task-id', 'update:subSidebarCollapsed'])

/**
 * Tab là biểu diễn của `scope` do shell giữ — tab Profile ↔ `scope='global'`,
 * tab Task ↔ `scope='task'`. Không thêm state song song, nhờ vậy watcher
 * `loadConfig` / xoá `taskId` khi rời tab Task giữ nguyên ý nghĩa.
 */
const tab = computed(() => (props.scope === 'task' ? 'task' : 'profile'))

function switchTab(next: string) {
  if (previewing.value) return
  if (tab.value === next) return
  // Đổi tab là nạp lại canvas theo đối tượng của tab kia — bản sửa chưa lưu mất.
  if (!confirmDiscardIfDirty()) return
  closeConfig()
  emit('update:scope', next === 'task' ? 'task' : 'global')
}

const tabs = computed(() => [
  { key: 'task', label: t('pipelineEditor.tabs.task') },
  { key: 'profile', label: t('pipelineEditor.tabs.profile') },
])

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

/** Task đang chờ gate: lưu pipeline sẽ huỷ gate đó, cảnh báo trước khi bấm. */
const taskHitlPending = computed(() => {
  if (tab.value !== 'task') return false
  const id = (props.taskId || '').trim()
  if (!id) return false
  return Boolean((props.tasks || []).find((t: any) => t.task_id === id)?.hitl_pending)
})

function onTaskSelectChange(value: string) {
  taskSelect.value = value
  if (value === '__manual__') {
    emit('update:task-id', taskManual.value)
  } else {
    emit('update:task-id', value)
    taskManual.value = ''
  }
}

function onTaskManualChange(value: string) {
  taskManual.value = value
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

const nodeTypes = {
  pipelineEditor: markRaw(PipelineEditorNode),
  artifact: markRaw(ArtifactNode),
  orchestrator: markRaw(OrchestratorNode),
} as any
const {
  setNodes,
  setEdges,
  updateNode,
  addEdges,
  removeNodes,
  getNodes,
  getEdges,
  onConnect,
  onNodesChange,
  onEdgesChange,
  fitView,
  screenToFlowCoordinate,
} = useVueFlow()

const nodes = ref([])
const edges = ref([])

const pipelineMeta = ref<PipelineMeta>({})

/**
 * Checkbox "Có node điều phối". Nguồn sự thật là `pipelineMeta.orchestrator` —
 * computed ghi thẳng vào meta để `assemblePipeline` mang key này ra YAML, và để
 * `syncDerivedGraph()` dựng lại node sau mỗi lần canvas đổi.
 */
const orchestratorEnabled = computed({
  get: () => pipelineMeta.value.orchestrator?.enabled === true,
  set: (enabled: boolean) => {
    pipelineMeta.value = {
      ...pipelineMeta.value,
      orchestrator: { ...(pipelineMeta.value.orchestrator ?? {}), enabled },
    }
    syncDerivedGraph()
  },
})
const stepPreserved = ref<StepPreservedMap>({})
const catalog = ref<any>({ skills: [], agents: [] })
const rulesData = ref({ rules: [], categories: [] })
const editorLeftCollapsed = computed(() => props.subSidebarCollapsed)

// Agents / Skills / Rules là các mục cùng cấp, mở/đóng độc lập. Gán lại
// `new Set(...)` để Vue thấy thay đổi (pattern `expanded` của TaskList).
const openSections = ref<Set<string>>(new Set(['agents']))

function toggleSection(key: string) {
  const next = new Set(openSections.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  openSections.value = next
}

function openSection(key: string) {
  openSections.value = new Set(openSections.value).add(key)
  // Panel ghi ngược lên shell: state chung nên `aria-expanded` của mode icon
  // không lệch pha khi panel tự mở lại từ dải icon.
  emit('update:subSidebarCollapsed', false)
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

// Xem markdown của 1 rule/agent/skill thay canvas — `v-if`/`v-else` thật ở
// slot `#main` để unmount VueFlow (không chỉ ẩn bằng CSS), tránh hook của nó
// bắt phím/sự kiện ngầm phía sau trong lúc đang xem.
const viewingDoc = ref<{ kind: 'rule' | 'agent' | 'skill'; id: string; name: string } | null>(null)
const viewingDocContent = ref('')
const viewingDocLoading = ref(false)
const viewingDocError = ref('')

async function openDocView(kind: 'rule' | 'agent' | 'skill', item: any) {
  if (viewingDoc.value?.kind === kind && viewingDoc.value?.id === item.id) {
    closeDocView()
    return
  }
  closeConfig()
  viewingDoc.value = { kind, id: item.id, name: item.name }
  viewingDocLoading.value = true
  viewingDocError.value = ''
  try {
    const data =
      kind === 'rule'
        ? await fetchRuleContent(item.id, props.projectId ?? undefined)
        : kind === 'agent'
          ? await fetchCatalogAgent(item.id, props.projectId ?? undefined)
          : await fetchSkillContent(item.id, props.projectId ?? undefined)
    viewingDocContent.value = data.content ?? ''
  } catch (e: any) {
    viewingDocContent.value = ''
    viewingDocError.value = String(e.message || e)
  } finally {
    viewingDocLoading.value = false
  }
}

function closeDocView() {
  viewingDoc.value = null
  viewingDocContent.value = ''
  viewingDocError.value = ''
}

/**
 * Đường nạp pipeline duy nhất — meta (`version` / `defaults` / `doc_reviewer`)
 * và field lạ của step chỉ được giữ nếu đi qua đây, nếu không profile lưu ra sẽ
 * không mở lại đúng.
 */
function applyLoadedPipeline(pipeline) {
  pipelineMeta.value = extractPipelineMeta(pipeline)
  stepPreserved.value = extractStepPreservedMap(pipeline?.steps || [])
  buildFlowFromPipeline(pipeline)
  lastLoadedSnapshot.value = snapshotCanvas()
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

  // Không đảo `setEdges` lên trước: `setEdges` loại bỏ edge có source/target
  // chưa nằm trong store, nên node phải vào trước.
  setStepNodes(newNodes)
  setEdges(newEdges)
  nodeCounter = steps.length
  syncDerivedGraph()
}

/**
 * Ghi danh sách step node lên canvas mà không làm rơi node phái sinh đang có.
 *
 * VueFlow tra node cũ theo id để cập nhật tại chỗ; id vắng mặt ở lần `setNodes`
 * này sẽ được cấp object mới, nhưng component `art-*` chụp object lúc setup và
 * không remount nên tiếp tục render object cũ đã rời store — node đứng yên ngoài
 * khung `fitView`. Vì vậy mọi `setNodes` phải mang theo cả node phái sinh, kể cả
 * khi `syncDerivedGraph()` dựng lại chúng ngay sau đó.
 */
function setStepNodes(nextStepNodes) {
  const stepIds = new Set(nextStepNodes.map((n) => n.id))
  // Step thật thắng khi trùng id — cùng luật với `buildEditorGraph`.
  const kept = derivedNodesOf(getNodes.value).filter((n) => !stepIds.has(n.id))
  setNodes([...nextStepNodes, ...kept])
}

/**
 * Dựng lại node/edge phái sinh (gate label + artifact/knowledge) từ step hiện tại.
 * Gọi sau mọi phép biến đổi canvas — trừ lúc đang kéo node (`setNodes` giữa drag
 * làm node giật), nên chỉ chạy ở `@node-drag-stop`.
 */
function syncDerivedGraph() {
  const stepNodes = stepNodesOf(getNodes.value)
  const stepIds = new Set(stepNodes.map((n) => n.id))
  const stepEdges = stepEdgesOf(getEdges.value, stepIds)
  const { nodes: nextNodes, edges: nextEdges } = buildEditorGraph({
    stepNodes,
    stepEdges,
    steps: currentSteps.value,
    labels: {
      producesTitle: t('common.artifactNode.producesTitle'),
      knowledgeTitle: t('common.artifactNode.knowledgeTitle'),
    },
    orchestrator: pipelineMeta.value.orchestrator as { enabled?: boolean; agent?: string } | undefined,
    orchestratorLabel: t('pipelineEditor.orchestrator.nodeLabel'),
  })
  setNodes(nextNodes)
  setEdges(nextEdges)
}

onConnect((params) => {
  addEdges([{ ...params, markerEnd: { type: 'arrowclosed' } }] as any)
  syncDerivedGraph()
})

onMounted(async () => {
  await Promise.all([loadCatalog(), loadRules(), loadConfig(), refreshProfiles()])
  setTimeout(() => fitView(), 100)
})

watch(() => props.projectId, () => {
  loadCatalog()
  loadRules()
})

let configDebounce = null
watch(
  [() => props.scope, () => props.taskId, () => props.projectId],
  ([scope, taskId, projectId], [, , prevProjectId]) => {
    closeConfig()
    closeDocView()
    clearTimeout(configDebounce)
    if (scope === 'global') {
      // Tab Profile cũng là `scope === 'global'`: quay lại tab mà nạp pipeline
      // global sẽ khiến canvas và select nói về hai đối tượng khác nhau, và
      // Save sau đó ghi đè profile bằng nội dung global. Đổi project là ngoại
      // lệ — lựa chọn cũ không còn nghĩa nên watcher bên dưới xoá nó.
      const keepSelection = projectId === prevProjectId
      if (keepSelection && profileSelected.value) {
        applyProfileToCanvas(profileSelected.value)
      } else {
        loadConfig()
      }
      return
    }
    if (!taskId?.trim()) {
      setNodes([])
      setEdges([])
      nodeCounter = 0
      pipelineMeta.value = {}
      stepPreserved.value = {}
      // Canvas rỗng là "sạch" — không reset thì confirm "bỏ thay đổi?" bật lên
      // trên một canvas chưa hề sửa.
      lastLoadedSnapshot.value = snapshotCanvas()
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

  // `nodeCounter` chỉ đếm từ số step của pipeline vừa nạp, nên sau vài lần
  // nạp/xoá nó có thể sinh lại một id đã tồn tại — tăng tiếp đến khi id trống.
  const existing = new Set(stepNodesOf(getNodes.value).map((n) => n.id))
  let id = `step-${item.name}-${++nodeCounter}`
  while (existing.has(id)) {
    id = `step-${item.name}-${++nodeCounter}`
  }

  const newNode = {
    id,
    type: 'pipelineEditor',
    position: { x: pos.x - 60, y: pos.y - 25 },
    data: {
      label: item.name,
      // Mục Skills là danh sách tra cứu: item không `draggable` nên không có
      // nguồn phát skill. `dataTransfer` vẫn là kênh mở — giữ nhánh phòng thủ
      // cho payload lạ.
      agent: item._type === 'agent' ? item.id : '',
      produces: [],
      knowledge_inputs: [],
      hitl: { mode: 'none' },
    },
  }
  setStepNodes([...stepNodesOf(getNodes.value), newNode])
  syncDerivedGraph()
}

const selectedNodeId = ref(null)
const selectedNodeData = ref(null)

function openConfig(nodeId, data) {
  // Dialog teleport ra <body> nên rule `.preview-active …` không với tới nó —
  // phải chặn bằng logic, không dựa vào CSS.
  if (previewing.value || viewingDoc.value) return
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
  setNodes(
    getNodes.value.map((n) =>
      n.id === nodeId ? { ...n, data: { ...n.data, ...updatedData } } : n,
    ),
  )
  closeConfig()
  syncDerivedGraph()
}

function deleteNode(nodeId) {
  // Đóng panel + dựng lại graph phái sinh do hook `onCanvasRemoval` lo, dùng
  // chung với đường xoá bằng phím của VueFlow — đừng làm lại ở đây.
  removeNodes([nodeId])
}

/**
 * Đường xoá thứ hai: nhấn `Backspace` khi node đang chọn thì VueFlow tự gọi
 * `removeNodes` / `removeEdges` bên trong thư viện, không đi qua `deleteNode`.
 * Không bắt ở đây thì node artifact của step vừa xoá ở lại canvas mồ côi cùng
 * edge `de-art-<id>-<stepKế>`.
 */
function onCanvasRemoval(changes) {
  if (!hasRemovalChange(changes)) return
  if (selectedNodeId.value && !getNodes.value.some((n) => n.id === selectedNodeId.value)) {
    closeConfig()
  }
  // Node điều phối không xoá được: `syncDerivedGraph()` dựng lại nó từ meta
  // chừng nào checkbox còn tick. Đây cũng là chỗ chặn đường xoá bằng `Backspace`,
  // đường mà nút ✕ (vốn không có trên node này) không với tới.
  syncDerivedGraph()
}

onNodesChange(onCanvasRemoval)
onEdgesChange(onCanvasRemoval)

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

/**
 * Step node + edge điều khiển hiện có trên canvas. Mọi phép tính sinh ra YAML
 * hoặc thứ tự chạy phải đi qua đây — node artifact/knowledge chỉ để nhìn, lọt vào
 * `buildFullPipeline` là sinh step rác `art-*` trong file lưu ra.
 */
function stepGraph(): { nodeList: any[]; edgeList: any[] } {
  const nodeList = stepNodesOf(getNodes.value)
  const edgeList = stepEdgesOf(getEdges.value, new Set(nodeList.map((n) => n.id)))
  return { nodeList, edgeList }
}

const previewOrder = computed(() => {
  const { nodeList, edgeList } = stepGraph()
  return topoSort(nodeList, edgeList)
})

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
  const node = stepNodesOf(getNodes.value).find((n) => n.id === previewNodeId.value)
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
  const { nodeList, edgeList } = stepGraph()
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
  const { nodeList, edgeList } = stepGraph()
  const order = topoSort(nodeList, edgeList)
  // Cập nhật tại chỗ thay vì dựng lại mảng: auto-layout chỉ đổi toạ độ, không
  // đổi tập node — xem `setStepNodes` về việc mất định danh node phái sinh.
  for (const n of nodeList) {
    const idx = order.indexOf(n.id)
    updateNode(n.id, { position: { x: 20 + Math.max(0, idx) * 220, y: 60 } })
  }
  syncDerivedGraph()
  setTimeout(() => fitView(), 50)
}

const {
  profiles,
  refresh: refreshProfiles,
  load: loadProfile,
  save: saveProfile,
  remove: removeProfile,
  error: profileError,
  download: downloadProfile,
  importFromFile,
} = usePipelineProfiles(() => props.projectId)

/** Profile chọn trong select — nguồn của auto-load. */
const profileSelected = ref('')
/** Tên sẽ ghi khi bấm Save; gõ tên mới ở đây tạo profile mới. */
const profileName = ref('')
/** Profile được nạp làm bản nháp cho task — không tự ghi file. */
const taskProfileName = ref('')

/** So sánh nông để hỏi trước khi bỏ thay đổi chưa lưu. */
const lastLoadedSnapshot = ref('')

function snapshotCanvas(): string {
  try {
    return JSON.stringify(buildFullPipeline())
  } catch {
    return ''
  }
}

function confirmDiscardIfDirty(): boolean {
  if (!lastLoadedSnapshot.value) return true
  if (snapshotCanvas() === lastLoadedSnapshot.value) return true
  return confirm(t('pipelineEditor.target.confirmDiscardChanges'))
}

async function applyProfileToCanvas(name: string): Promise<void> {
  const pipeline = await loadProfile(name)
  if (!pipeline) {
    saveMsg.value = profileError.value ? `✗ ${profileError.value}` : ''
    return
  }
  applyLoadedPipeline(pipeline)
  setTimeout(() => fitView(), 100)
}

/**
 * Đặt lại giá trị select mà không kích hoạt auto-load.
 * Cần thiết vì watcher tự ghi ngược vào chính ref nó đang theo dõi (khi người
 * dùng huỷ confirm, hoặc sau khi Save): không chặn thì mỗi lần huỷ lại hỏi lại.
 */
let suppressAutoLoad = false

function setSelectionSilently(target: { value: string }, next: string) {
  suppressAutoLoad = true
  target.value = next
  // Watcher chạy sau microtask của Vue — trả cờ lại ở đó, không phải ngay đây.
  Promise.resolve().then(() => { suppressAutoLoad = false })
}

// Không còn nút "Load profile": đổi select là nạp luôn.
watch(profileSelected, async (name, prev) => {
  if (suppressAutoLoad || !name) return
  if (!confirmDiscardIfDirty()) {
    setSelectionSilently(profileSelected, prev ?? '')
    return
  }
  profileName.value = name
  await applyProfileToCanvas(name)
})

// Nạp bản nháp lên canvas, không ghi `tasks/<id>/pipeline.yaml`.
watch(taskProfileName, async (name, prev) => {
  if (suppressAutoLoad || !name) return
  if (!confirmDiscardIfDirty()) {
    setSelectionSilently(taskProfileName, prev ?? '')
    return
  }
  await applyProfileToCanvas(name)
})

// Profile của task trước không phải profile của task sau.
watch(() => props.taskId, () => { taskProfileName.value = '' })

// Danh sách profile là per-project — lựa chọn cũ không còn nghĩa.
watch(() => props.projectId, () => {
  profileSelected.value = ''
  profileName.value = ''
  taskProfileName.value = ''
})

const saving = ref(false)
const saveMsg = ref('')

function flashSaved(msg: string) {
  saveMsg.value = msg
  setTimeout(() => {
    if (saveMsg.value === msg) saveMsg.value = ''
  }, 2500)
}

/** "Save" và "Save to file" gộp làm một, rẽ nhánh theo tab đang mở. */
async function handleSave() {
  saving.value = true
  saveMsg.value = ''
  try {
    if (tab.value === 'profile') {
      const name = profileName.value.trim()
      if (!name) {
        saveMsg.value = t('pipelineEditor.target.needProfileName')
        return
      }
      const ok = await saveProfile(name, buildFullPipeline())
      if (!ok) {
        saveMsg.value = `✗ ${profileError.value}`
        return
      }
      await refreshProfiles()
      lastLoadedSnapshot.value = snapshotCanvas()
      // Canvas ĐANG là nội dung vừa ghi — nạp lại từ server chỉ tốn một vòng
      // request và làm mất vị trí node người dùng vừa sắp.
      if (profileSelected.value !== name) setSelectionSilently(profileSelected, name)
    } else {
      if (taskWriteBlocked.value) {
        saveMsg.value = t('pipelineEditor.target.taskWriteBlocked')
        return
      }
      if (!props.taskId?.trim()) {
        saveMsg.value = t('pipelineEditor.target.needTask')
        return
      }
      await writePipelineConfig('task', buildFullPipeline(), props.taskId, props.projectId ?? undefined)
      lastLoadedSnapshot.value = snapshotCanvas()
    }
    flashSaved(t('pipelineEditor.target.saved'))
  } catch (e) {
    saveMsg.value = `✗ ${e.message}`
  } finally {
    saving.value = false
  }
}

async function handleDeleteProfile() {
  const name = profileSelected.value
  if (!name) return
  if (!confirm(t('pipelineEditor.target.confirmDeleteProfile', { name }))) return
  const ok = await removeProfile(name)
  if (!ok) {
    saveMsg.value = `✗ ${profileError.value}`
    return
  }
  // Giữ nguyên canvas — người dùng vừa mất file, đừng mất luôn công việc đang mở.
  profileSelected.value = ''
  await refreshProfiles()
}

async function handleDownloadProfile() {
  const name = profileSelected.value
  if (!name) return
  try {
    const text = await downloadProfile(name)
    const blob = new Blob([text], { type: 'text/yaml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name}.yaml`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch (e: any) {
    saveMsg.value = `✗ ${e.message}`
  }
}

async function handleImportProfileFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const ok = await importFromFile(file, {
    confirmOverwrite: (name) => Promise.resolve(confirm(t('pipelineEditor.target.confirmOverwriteProfile', { name }))),
  })
  if (ok === null) return // user huỷ ghi đè — no-op, không phải lỗi
  if (!ok) {
    saveMsg.value = `✗ ${profileError.value}`
    return
  }
  await refreshProfiles()
  flashSaved(t('pipelineEditor.target.saved'))
}

/**
 * "Mặc định" = nội dung `pipeline.yaml` global, nên set-as-default ghi chính
 * canvas đang mở xuống đó. Đây cũng là đường duy nhất còn lại để sửa trực tiếp
 * pipeline global sau khi select `Scope` biến mất.
 */
async function handleSetDefault() {
  if (!currentSteps.value.length) return
  if (!confirm(t('pipelineEditor.target.confirmSetDefault'))) return
  saving.value = true
  saveMsg.value = ''
  try {
    await writePipelineConfig('global', buildFullPipeline(), undefined, props.projectId ?? undefined)
    flashSaved(t('pipelineEditor.target.defaultSet'))
  } catch (e) {
    saveMsg.value = `✗ ${e.message}`
  } finally {
    saving.value = false
  }
}

/**
 * Chỉ khoá Save ở tab Task, nơi lý do (chưa chọn task / task đã đóng) đã hiển thị
 * sẵn. Ở tab Profile để nút bấm được: thiếu tên thì `handleSave` nói rõ "nhập tên
 * profile", còn nút xám không lý do thì người dùng chỉ biết bó tay.
 */
const saveDisabled = computed(() => tab.value === 'task' && taskWriteBlocked.value)

const { state: previewing, setTrue: startPreview, setFalse: stopPreview } = useLocalToggle(false)
const previewNodeId = ref(null)
const previewHitlPause = ref(false)
let previewTimer = null

async function runPreview() {
  if (previewing.value) return
  closeConfig()
  closeDocView()
  startPreview()
  const order = previewOrder.value
  previewNodeId.value = null
  previewHitlPause.value = false

  for (const id of order) {
    if (!previewing.value) break
    previewNodeId.value = id
    previewHitlPause.value = false
    await sleep(600)
    if (!previewing.value) break
    const node = stepNodesOf(getNodes.value).find((n) => n.id === id)
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

const currentPipeline = computed(() => buildFullPipeline())
const currentSteps = computed(() => {
  const steps = currentPipeline.value.steps
  return Array.isArray(steps) ? steps : []
})

const hasFanOut = computed(() => {
  const { edgeList } = stepGraph()
  const outDeg = {}
  for (const e of edgeList) {
    outDeg[e.source] = (outDeg[e.source] || 0) + 1
  }
  return Object.values(outDeg).some((d: any) => d > 1)
})

</script>

<template>
  <div class="editor-root" :class="{ 'preview-active': previewing }">
    <CScreenLayout
      :tabs="tabs"
      :active-tab-key="tab"
      :tabs-aria-label="t('pipelineEditor.tabs.ariaLabel')"
      :sub-sidebar-collapsed="editorLeftCollapsed"
      main-overflow="hidden"
      @update:active-tab-key="switchTab"
    >
      <template #top-extra>
        <div v-if="hasFanOut" class="fanout-warning" role="status">
          {{ t('pipelineEditor.toolbar.fanOutWarning') }}
        </div>
      </template>

      <template #left>
        <EditorTargetPanel
          :tab="tab"
          :collapsed="editorLeftCollapsed"
          :profiles="profiles"
          :profile-selected="profileSelected"
          :profile-name="profileName"
          :task-profile="taskProfileName"
          :tasks="editableTasks"
          :task-select="taskSelect"
          :task-manual="taskManual"
          :saving="saving"
          :previewing="previewing"
          :save-disabled="saveDisabled"
          :set-default-disabled="!currentSteps.length"
          :orchestrator-enabled="orchestratorEnabled"
          :message="saveMsg"
          :warning="taskHitlPending ? t('pipelineEditor.target.hitlPendingWarning') : ''"
          @update:profile-selected="profileSelected = $event"
          @update:profile-name="profileName = $event"
          @update:task-profile="taskProfileName = $event"
          @update:task-select="onTaskSelectChange"
          @update:task-manual="onTaskManualChange"
          @update:orchestrator-enabled="orchestratorEnabled = $event"
          @save="handleSave"
          @delete-profile="handleDeleteProfile"
          @set-default="handleSetDefault"
          @auto-layout="autoLayout"
          @preview="runPreview"
          @stop="stopDemo"
          @open-section="openSection"
          @download="handleDownloadProfile"
          @import-file="handleImportProfileFile"
        />

        <!-- Chỉ khoá phần nội dung khi preview; cụm action (có Stop) vẫn bấm được -->
        <div v-if="!editorLeftCollapsed" class="editor-left-sections">
          <CatalogPanel
            :catalog="catalog"
            :open-sections="openSections"
            @toggle-section="toggleSection"
            @view-agent="(a) => openDocView('agent', a)"
            @view-skill="(s) => openDocView('skill', s)"
          />
          <RulesPanel
            :rules="rulesData.rules"
            :categories="rulesData.categories"
            :open-sections="openSections"
            @toggle-section="toggleSection"
            @view="(rule) => openDocView('rule', rule)"
          />
        </div>
      </template>

      <template #main>
        <div v-if="viewingDoc" class="rule-view">
          <div class="rule-view-header">
            <span class="rule-view-title">{{ viewingDoc.name }}</span>
            <button type="button" class="btn-ghost btn-sm" @click="closeDocView">
              {{ t('pipelineEditor.docView.close') }}
            </button>
          </div>
          <p v-if="viewingDocLoading" class="muted rule-view-status">{{ t('pipelineEditor.docView.loading') }}</p>
          <p v-else-if="viewingDocError" class="err rule-view-status">{{ t('pipelineEditor.docView.loadError') }}</p>
          <CMarkdownView
            v-else
            :title="viewingDoc.name"
            :doc-key="viewingDoc.id"
            :content="viewingDocContent"
          />
        </div>
        <div
          v-else
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
            @node-drag-stop="syncDerivedGraph"
          >
            <template #node-pipelineEditor="nodeProps">
              <PipelineEditorNode
                v-bind="nodeProps"
                :preview-state="getPreviewState(nodeProps.id)"
                @edit="openConfig"
                @delete="deleteNode"
              />
            </template>
            <template #node-artifact="nodeProps">
              <ArtifactNode v-bind="nodeProps" />
            </template>
            <template #node-orchestrator="nodeProps">
              <OrchestratorNode v-bind="nodeProps" />
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
            <button type="button" class="btn-danger btn-xs" @click="stopDemo">
              {{ t('pipelineEditor.target.stop') }}
            </button>
          </div>
        </div>
      </template>
    </CScreenLayout>

    <StepConfigDialog
      v-if="selectedNodeId"
      :step-id="selectedNodeId"
      :step="selectedNodeData"
      :catalog="catalog"
      :project-id="projectId"
      @update="applyStepUpdate"
      @close="closeConfig"
    />
  </div>
</template>

<style scoped lang="scss">
.editor-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
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
.editor-canvas {
  position: relative;
  overflow: hidden;
  height: 100%;
}
.rule-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  border-left: 1px solid var(--border);
}
.rule-view-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.rule-view-title { font-size: 13px; font-weight: 600; }
.rule-view-status { padding: 16px; }
.rule-view-status.err { color: var(--danger); }
.rule-view > .c-md-view {
  flex: 1;
  min-height: 0;
  height: auto;
}
/* Canvas mang cả 2 class, nên selector phải dính liền; viết rời (descendant)
   thì rule không khớp và bo tròn 12px của `.vflow-container` dùng chung lại thắng. */
.editor-canvas.vflow-container {
  height: 100%;
  border-radius: 0;
  border: none;
  border-left: 1px solid var(--border);
}

.preview-active .editor-left-sections { opacity: 0.5; pointer-events: none; }
.preview-active :deep(.c-screen-layout__top) { opacity: 0.6; pointer-events: none; }

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

/* Hợp đồng cuộn của Task list (docs/architecture/4-code/ui-overflow.md): container ngoài KHÔNG cuộn,
   chỉ lá (`.catalog-list` / `.rules-scroll`) mới mang `overflow-y: auto`. Để
   `auto` ở đây là dựng scroller thứ hai và nuốt mất trách nhiệm cuộn của lá. */
.editor-left-sections {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>
