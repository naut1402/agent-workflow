/**
 * Dựng graph render cho canvas editor: step node/edge do người dùng sửa, cộng
 * thêm node artifact/knowledge + edge dữ liệu **phái sinh** từ chính các step đó.
 *
 * Node phái sinh chỉ tồn tại để nhìn — chúng không phải step. Mọi phép tính sinh
 * ra YAML (`buildFullPipeline`, `topoSort`, `hasFanOut`…) phải lọc chúng qua
 * `stepNodesOf` / `stepEdgesOf` trước, nếu không YAML sẽ mọc step rác `art-*`.
 */
import {
  buildArtifactNodesAndEdges,
  type ArtifactGraphLabels,
  type PhasePosition,
  type PipelineStepLike,
} from '../../../core/lib/pipelineArtifactGraph'

/** Type của node step trên canvas — node phái sinh dùng type `artifact`. */
const STEP_NODE_TYPE = 'pipelineEditor'

/** Node step trên canvas — chỉ khai báo phần `canvasGraph` thật sự đọc tới. */
export type StepNodeLike = {
  id: string
  type?: string
  position?: Partial<PhasePosition>
  data?: { hitl?: { mode?: string; gate_id?: string } }
}

export type FlowEdgeLike = {
  id?: string
  source?: string
  target?: string
}

export function isStepNode(node: StepNodeLike | null | undefined): boolean {
  return node?.type === STEP_NODE_TYPE
}

export function stepNodesOf<T extends StepNodeLike>(nodes: T[] | null | undefined): T[] {
  return (nodes ?? []).filter(isStepNode)
}

/** Edge điều khiển = cả 2 đầu đều là step node (loại edge dữ liệu `de-*`). */
export function stepEdgesOf<T extends FlowEdgeLike>(
  edges: T[] | null | undefined,
  stepIds: Set<string>,
): T[] {
  return (edges ?? []).filter(
    (e) => stepIds.has(e?.source as string) && stepIds.has(e?.target as string),
  )
}

/** Nhãn gate của một step = `gate_id`, chỉ khi HITL bật. */
export function gateLabelOf(node: StepNodeLike | null | undefined): string {
  const hitl = node?.data?.hitl
  if (!hitl || !hitl.mode || hitl.mode === 'none') return ''
  return hitl.gate_id || ''
}

export function buildEditorGraph(opts: {
  stepNodes: StepNodeLike[]
  stepEdges: FlowEdgeLike[]
  /** = `currentSteps` (đã qua `buildStepFromNode`) — nguồn `produces`/`knowledge_inputs`. */
  steps: PipelineStepLike[]
  labels: ArtifactGraphLabels
  // Trả `any[]`: kết quả đi thẳng vào `setNodes`/`setEdges` của VueFlow, mà
  // `Node`/`Edge` của thư viện đòi những field nominal (`XYPosition`,
  // `MarkerType`) builder thuần này cố ý không biết tới.
}): { nodes: any[]; edges: any[] } {
  const stepNodes = opts.stepNodes ?? []
  const stepIds = new Set(stepNodes.map((n) => n.id))
  const byId: Record<string, StepNodeLike> = Object.fromEntries(stepNodes.map((n) => [n.id, n]))

  const labelledEdges = (opts.stepEdges ?? []).map((e) => ({
    ...e,
    label: gateLabelOf(byId[e.source as string]),
    labelStyle: { fill: 'var(--muted)', fontWeight: 400 },
  }))

  const phasePositions: Record<string, PhasePosition> = Object.fromEntries(
    stepNodes.map((n) => [n.id, { x: n.position?.x ?? 0, y: n.position?.y ?? 0 }]),
  )

  const { artifactNodes, dataFlowEdges } = buildArtifactNodesAndEdges({
    steps: opts.steps ?? [],
    phasePositions,
    // Editor không biết file đã tồn tại trên đĩa hay chưa → mọi artifact hiện `○`.
    artifacts: {},
    labels: opts.labels,
  })

  // Một step tên đúng bằng `art-<id>` sẽ đụng id với node phái sinh; step thật
  // thắng, node phái sinh (và edge dính vào nó) bị bỏ.
  const droppedIds = new Set(artifactNodes.filter((a) => stepIds.has(a.id)).map((a) => a.id))
  const keptArtifactNodes = artifactNodes.filter((a) => !droppedIds.has(a.id))
  const keptDataFlowEdges = dataFlowEdges.filter(
    (e) => !droppedIds.has(e.source) && !droppedIds.has(e.target),
  )

  return {
    nodes: [...stepNodes, ...keptArtifactNodes],
    edges: [...labelledEdges, ...keptDataFlowEdges],
  }
}

/** Change của VueFlow mà `canvasGraph` cần phân biệt — chỉ đọc tới `type`. */
export type FlowChangeLike = { type?: string }

/**
 * Có phần tử nào vừa bị **xoá** khỏi canvas không.
 *
 * VueFlow bắn `nodesChange` / `edgesChange` cho cả `select` / `position` /
 * `dimensions`; chỉ change `remove` mới cần dựng lại graph phái sinh, sync ở
 * mọi change sẽ làm node giật lúc kéo.
 */
export function hasRemovalChange(
  changes: readonly (FlowChangeLike | null | undefined)[] | null | undefined,
): boolean {
  return (changes ?? []).some((c) => c?.type === 'remove')
}
