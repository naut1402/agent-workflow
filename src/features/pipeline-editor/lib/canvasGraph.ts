/**
 * Dựng graph render cho canvas editor: step node/edge do người dùng sửa, cộng
 * thêm node artifact/knowledge + edge dữ liệu **phái sinh** từ chính các step đó.
 *
 * Node phái sinh chỉ tồn tại để nhìn — chúng không phải step. Mọi phép tính sinh
 * ra YAML (`buildFullPipeline`, `topoSort`, `hasFanOut`…) phải lọc chúng qua
 * `stepNodesOf` / `stepEdgesOf` trước, nếu không YAML sẽ mọc step rác `art-*`.
 */
import { buildArtifactNodesAndEdges } from '../../../core/lib/pipelineArtifactGraph'

export const STEP_NODE_TYPE = 'pipelineEditor'

export function isStepNode(node: any): boolean {
  return node?.type === STEP_NODE_TYPE
}

export function stepNodesOf(nodes: any[]): any[] {
  return (nodes ?? []).filter(isStepNode)
}

/** Edge điều khiển = cả 2 đầu đều là step node (loại edge dữ liệu `de-*`). */
export function stepEdgesOf(edges: any[], stepIds: Set<string>): any[] {
  return (edges ?? []).filter((e) => stepIds.has(e?.source) && stepIds.has(e?.target))
}

/** Nhãn gate của một step = `gate_id`, chỉ khi HITL bật. */
export function gateLabelOf(node: any): string {
  const hitl = node?.data?.hitl
  if (!hitl || !hitl.mode || hitl.mode === 'none') return ''
  return hitl.gate_id || ''
}

export function buildEditorGraph(opts: {
  stepNodes: any[]
  stepEdges: any[]
  /** = `currentSteps` (đã qua `buildStepFromNode`) — nguồn `produces`/`knowledge_inputs`. */
  steps: any[]
  labels: { producesTitle: string; knowledgeTitle: string }
}): { nodes: any[]; edges: any[] } {
  const stepNodes = opts.stepNodes ?? []
  const stepIds = new Set(stepNodes.map((n) => n.id))
  const byId = Object.fromEntries(stepNodes.map((n) => [n.id, n]))

  const labelledEdges = (opts.stepEdges ?? []).map((e) => ({
    ...e,
    label: gateLabelOf(byId[e.source]),
    labelStyle: { fill: 'var(--muted)', fontWeight: 400 },
  }))

  const phasePositions = Object.fromEntries(
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
