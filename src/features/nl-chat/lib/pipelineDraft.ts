import { slugify as slugifyBase } from '../../../shared/lib/stringUtils'

const DEFAULT_VERSION = 1

function slugify(raw: string): string {
  const tail = raw.split(':').pop() ?? raw
  return slugifyBase(tail, { maxLength: 80, fallback: '' })
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

/**
 * Returns a new pipeline object; the input is never mutated.
 * xem docs/architecture/code/nl-chat.md §5
 */
export function normalizePipelineDraft(draft: unknown): Record<string, unknown> {
  const src = asRecord(draft) ?? {}
  const rawSteps = Array.isArray(src.steps) ? src.steps : []
  const used = new Set<string>()

  const steps = rawSteps.map((rawStep, i) => {
    const step = { ...(asRecord(rawStep) ?? {}) }
    let id = stepId(step, i)
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
