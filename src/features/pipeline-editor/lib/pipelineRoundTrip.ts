/** Keys của step do canvas/UI quản lý — phần còn lại vào preserved */
const CANVAS_STEP_KEYS = new Set([
  'id', 'name', 'agent', 'skills', 'rule_category', 'rule_required',
  'produces', 'knowledge_inputs', 'hitl',
])

export type PipelineMeta = {
  version?: number
  defaults?: Record<string, unknown>
  doc_reviewer?: Record<string, unknown>
}

export type StepPreservedMap = Record<string, Record<string, unknown>>

export function extractPipelineMeta(pipeline: unknown): PipelineMeta {
  const p = pipeline as Record<string, unknown> | null | undefined
  if (!p || typeof p !== 'object') return {}
  const meta: PipelineMeta = {}
  if (p.version != null) meta.version = p.version as number
  if (p.defaults && typeof p.defaults === 'object') meta.defaults = { ...(p.defaults as object) }
  if (p.doc_reviewer && typeof p.doc_reviewer === 'object') {
    meta.doc_reviewer = { ...(p.doc_reviewer as object) }
  }
  return meta
}

export function extractStepPreservedMap(steps: unknown[]): StepPreservedMap {
  const map: StepPreservedMap = {}
  for (const step of steps || []) {
    if (!step || typeof step !== 'object' || !('id' in step)) continue
    const s = step as Record<string, unknown>
    const id = String(s.id)
    const preserved: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(s)) {
      if (!CANVAS_STEP_KEYS.has(k)) preserved[k] = v
    }
    if (Object.keys(preserved).length) map[id] = preserved
  }
  return map
}

function mergeHitl(preservedHitl: unknown, nodeHitl: unknown): unknown {
  if (!nodeHitl || (nodeHitl as { mode?: string }).mode === 'none') return { mode: 'none' }
  const base = preservedHitl && typeof preservedHitl === 'object' ? preservedHitl : {}
  return { ...base, ...(nodeHitl as object) }
}

/** Build một step YAML từ node + preserved */
export function buildStepFromNode(
  nodeData: Record<string, unknown>,
  stepId: string,
  preserved?: Record<string, unknown>,
): Record<string, unknown> {
  const fromNode = {
    id: stepId,
    name: nodeData.label || stepId,
    agent: nodeData.agent || '',
    skills: nodeData.skills || [],
    rule_category: nodeData.rule_category || '',
    rule_required: nodeData.rule_required ?? true,
    produces: nodeData.produces || [],
    knowledge_inputs: nodeData.knowledge_inputs || [],
    hitl: nodeData.hitl || { mode: 'none' },
  }
  const merged = { ...(preserved || {}), ...fromNode }
  merged.hitl = mergeHitl(preserved?.hitl, fromNode.hitl)
  return merged
}

/** Ghép meta + ordered steps thành pipeline object để POST */
export function assemblePipeline(
  meta: PipelineMeta,
  steps: Record<string, unknown>[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (meta.version != null) out.version = meta.version
  else out.version = 1
  if (meta.defaults) out.defaults = { ...meta.defaults }
  out.steps = steps
  if (meta.doc_reviewer) out.doc_reviewer = { ...meta.doc_reviewer }
  return out
}
