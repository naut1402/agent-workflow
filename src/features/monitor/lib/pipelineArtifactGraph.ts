/**
 * Pure builder for VueFlow artifact / knowledge nodes and data-flow edges.
 * Control-flow (step→step) stays in PipelineView — this module only returns
 * dashed data-flow edges so compose never double-counts.
 */

export const NODE_SPACING = 200
export const NODE_Y = 40
export const ARTIFACT_Y_OFFSET = 100
export const KNOWLEDGE_Y_OFFSET = -70

const ARTIFACT_X_NUDGE = 40

export type PhasePosition = { x: number; y: number }

export type ArtifactFileEntry = { name: string; exists: boolean }
export type KnowledgeEntry = { id: string; stepId: string }

export type ArtifactNodeData =
  | {
      kind: 'produces'
      stepId: string
      label: string
      files: ArtifactFileEntry[]
    }
  | {
      kind: 'knowledge'
      label: string
      entries: KnowledgeEntry[]
    }

export type ArtifactFlowNode = {
  id: string
  type: 'artifact'
  draggable: false
  selectable: false
  position: PhasePosition
  data: ArtifactNodeData
}

export type DataFlowEdge = {
  id: string
  source: string
  target: string
  animated: false
  style: { stroke: string; strokeWidth: number; strokeDasharray: string }
  markerEnd: { type: string; color: string }
}

export type ArtifactGraphLabels = {
  producesTitle: string
  knowledgeTitle: string
}

export type PipelineStepLike = {
  id?: string
  produces?: unknown
  knowledge_inputs?: unknown
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

function dashedEdge(id: string, source: string, target: string): DataFlowEdge {
  return {
    id,
    source,
    target,
    animated: false,
    style: { stroke: 'var(--muted)', strokeWidth: 1.5, strokeDasharray: '4 4' },
    markerEnd: { type: 'arrowclosed', color: 'var(--muted)' },
  }
}

function derivedProducesX(stepX: number): number {
  return stepX + ARTIFACT_X_NUDGE
}

/**
 * Build artifact/knowledge nodes + data-flow edges from pipeline steps.
 * Positions are derived from phasePositions (already overlayed with flow-profile).
 */
export function buildArtifactNodesAndEdges(opts: {
  steps: PipelineStepLike[] | null | undefined
  phasePositions: Record<string, PhasePosition>
  artifacts?: Record<string, { exists?: boolean } | null | undefined> | null
  labels?: Partial<ArtifactGraphLabels>
}): { artifactNodes: ArtifactFlowNode[]; dataFlowEdges: DataFlowEdge[] } {
  const steps = Array.isArray(opts.steps) ? opts.steps : []
  const artifacts = opts.artifacts ?? {}
  const producesTitle = opts.labels?.producesTitle ?? 'Artifacts'
  const knowledgeTitle = opts.labels?.knowledgeTitle ?? 'Knowledge'

  const artifactNodes: ArtifactFlowNode[] = []
  const dataFlowEdges: DataFlowEdge[] = []

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const stepId = typeof step?.id === 'string' ? step.id : ''
    if (!stepId) continue

    const files = Array.isArray(step.produces)
      ? step.produces.filter(nonEmptyString)
      : []
    if (files.length === 0) continue

    const pos = opts.phasePositions[stepId] ?? { x: i * NODE_SPACING, y: NODE_Y }
    const next = steps[i + 1]
    const nextId = typeof next?.id === 'string' ? next.id : null

    artifactNodes.push({
      id: `art-${stepId}`,
      type: 'artifact',
      draggable: false,
      selectable: false,
      position: {
        x: derivedProducesX(pos.x),
        y: pos.y + ARTIFACT_Y_OFFSET,
      },
      data: {
        kind: 'produces',
        stepId,
        label: producesTitle,
        files: files.map((name) => ({
          name,
          exists: Boolean(artifacts?.[name]?.exists),
        })),
      },
    })

    dataFlowEdges.push(dashedEdge(`de-${stepId}-art-${stepId}`, stepId, `art-${stepId}`))

    if (nextId) {
      dataFlowEdges.push(dashedEdge(`de-art-${stepId}-${nextId}`, `art-${stepId}`, nextId))
    }
  }

  const consumers = steps.filter((s) => {
    const id = typeof s?.id === 'string' ? s.id : ''
    if (!id) return false
    return Array.isArray(s.knowledge_inputs) && s.knowledge_inputs.some(nonEmptyString)
  })

  if (consumers.length === 0) {
    return { artifactNodes, dataFlowEdges }
  }

  const entries: KnowledgeEntry[] = []
  for (const s of consumers) {
    const stepId = s.id as string
    for (const kid of s.knowledge_inputs as unknown[]) {
      if (!nonEmptyString(kid)) continue
      entries.push({ id: kid, stepId })
    }
  }

  const firstConsumerId = consumers[0].id as string
  const firstPos = opts.phasePositions[firstConsumerId] ?? { x: 0, y: NODE_Y }

  artifactNodes.push({
    id: 'art-knowledge',
    type: 'artifact',
    draggable: false,
    selectable: false,
    position: {
      x: firstPos.x,
      y: NODE_Y + KNOWLEDGE_Y_OFFSET,
    },
    data: {
      kind: 'knowledge',
      label: knowledgeTitle,
      entries,
    },
  })

  for (const s of consumers) {
    const stepId = s.id as string
    dataFlowEdges.push(dashedEdge(`de-art-knowledge-${stepId}`, 'art-knowledge', stepId))
  }

  return { artifactNodes, dataFlowEdges }
}
