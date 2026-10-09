// xem docs/architecture/code/pipeline-editor.md §2
import {
  buildArtifactNodesAndEdges,
  type ArtifactGraphLabels,
  type PhasePosition,
  type PipelineStepLike,
} from '../../../frontend/lib/pipelineArtifactGraph'
import {
  ORCHESTRATOR_NODE_ID,
  orchestratorPositionOf,
} from '../../../frontend/lib/orchestratorNode'

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

/** Bù của `stepNodesOf` — node phái sinh (artifact / knowledge) đang nằm trên canvas. */
export function derivedNodesOf<T extends StepNodeLike>(nodes: T[] | null | undefined): T[] {
  return (nodes ?? []).filter((n) => !isStepNode(n))
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
  /** Key `orchestrator` của pipeline — node điều phối dựng từ meta này, không từ canvas. */
  orchestrator?: { enabled?: boolean; agent?: string } | null
  /** Nhãn node điều phối (i18n do caller truyền — builder này thuần). */
  orchestratorLabel?: string
}): { nodes: any[]; edges: any[] } {
  const stepNodes = opts.stepNodes ?? []
  const stepIds = new Set(stepNodes.map((n) => n.id))
  const byId: Record<string, StepNodeLike> = Object.fromEntries(stepNodes.map((n) => [n.id, n]))

  const hubEnabled = opts.orchestrator?.enabled === true

  // xem docs/architecture/code/pipeline-editor.md §2
  const labelledEdges = (opts.stepEdges ?? []).map((e) => ({
    ...e,
    label: gateLabelOf(byId[e.source as string]),
    labelStyle: { fill: 'var(--muted)', fontWeight: 400 },
    hidden: hubEnabled,
  }))

  const phasePositions: Record<string, PhasePosition> = Object.fromEntries(
    stepNodes.map((n) => [n.id, { x: n.position?.x ?? 0, y: n.position?.y ?? 0 }]),
  )

  const { artifactNodes, dataFlowEdges } = buildArtifactNodesAndEdges({
    steps: opts.steps ?? [],
    phasePositions,
    artifacts: {},
    labels: opts.labels,
  })

  const droppedIds = new Set(artifactNodes.filter((a) => stepIds.has(a.id)).map((a) => a.id))
  const keptArtifactNodes = artifactNodes.filter((a) => !droppedIds.has(a.id))
  const keptDataFlowEdges = dataFlowEdges.filter(
    (e) => !droppedIds.has(e.source) && !droppedIds.has(e.target),
  )

  // xem docs/architecture/code/pipeline-editor.md §2
  const orchestratorNodes =
    opts.orchestrator?.enabled === true
      ? [
          {
            id: ORCHESTRATOR_NODE_ID,
            type: 'orchestrator',
            position: orchestratorPositionOf(phasePositions),
            draggable: false,
            selectable: false,
            deletable: false,
            data: {
              label: opts.orchestratorLabel ?? 'Orchestrator',
              agent: opts.orchestrator.agent ?? '',
            },
          },
        ]
      : []

  const hubEdges = hubEnabled
    ? stepNodes.map((n) => ({
        id: `e-${ORCHESTRATOR_NODE_ID}-${n.id}`,
        source: ORCHESTRATOR_NODE_ID,
        target: n.id,
        markerEnd: { type: 'arrowclosed' },
      }))
    : []

  return {
    nodes: [...stepNodes, ...keptArtifactNodes, ...orchestratorNodes],
    edges: [...labelledEdges, ...keptDataFlowEdges, ...hubEdges],
  }
}

/** Change của VueFlow mà `canvasGraph` cần phân biệt — chỉ đọc tới `type`. */
export type FlowChangeLike = { type?: string }

/** Có change `remove` nào trong lô change của VueFlow không. */
export function hasRemovalChange(
  changes: readonly (FlowChangeLike | null | undefined)[] | null | undefined,
): boolean {
  return (changes ?? []).some((c) => c?.type === 'remove')
}
