/**
 * Normalize a pipeline draft coming from the `nl-chat-builder` agent into the
 * shape the Pipeline Editor can actually open.
 *
 * `POST /api/pipeline-profiles` only checks that `steps` is an array, so a
 * draft whose steps carry just `{ agent }` saves fine but is unopenable:
 * `buildFlowFromPipeline()` maps each step to a Vue Flow node keyed by
 * `step.id`, and `extractStepPreservedMap()` skips steps without one — so an
 * id-less profile renders as broken/empty nodes. The agent is asked for
 * `id`/`name` in the prompt; this fills them in deterministically when it
 * doesn't comply, and is applied to the (user-editable) draft before saving.
 */

const DEFAULT_VERSION = 1

/** `plugin:dev-agent-teams:implementer` → `implementer`; keeps [a-z0-9-] only. */
function slugify(raw: string): string {
  const tail = raw.split(':').pop() ?? raw
  return tail
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // \u0111/\u0110 has no NFD decomposition \u2014 without this a Vietnamese step name that
    // starts with it loses its first letter.
    .replace(/\u0111/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stepId(step: Record<string, unknown>, index: number): string {
  for (const key of ['id', 'name', 'agent'] as const) {
    const raw = step[key]
    if (typeof raw === 'string' && slugify(raw)) return slugify(raw)
  }
  return `step-${index + 1}`
}

/** Returns a new pipeline object; the input is never mutated. */
export function normalizePipelineDraft(draft: unknown): Record<string, unknown> {
  const src = asRecord(draft) ?? {}
  const rawSteps = Array.isArray(src.steps) ? src.steps : []
  const used = new Set<string>()

  const steps = rawSteps.map((rawStep, i) => {
    const step = { ...(asRecord(rawStep) ?? {}) }
    let id = stepId(step, i)
    // Vue Flow node ids must be unique — a duplicate would silently drop a node.
    for (let n = 2; used.has(id); n += 1) id = `${stepId(step, i)}-${n}`
    used.add(id)
    step.id = id
    if (typeof step.name !== 'string' || !step.name.trim()) step.name = id
    if (!asRecord(step.hitl)) step.hitl = { mode: 'none' }
    return step
  })

  return {
    ...src,
    version: typeof src.version === 'number' ? src.version : DEFAULT_VERSION,
    steps,
  }
}
