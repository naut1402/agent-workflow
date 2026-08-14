/**
 * Mirror `src/features/runner/business/jobQueue.ts` `stepIdOf`.
 * Keep FE-side so Vite does not pull Node/fs jobQueue into the bundle.
 */
export function stepIdOf(job: { metadata?: Record<string, unknown> }): string | undefined {
  const meta = job.metadata || {}
  if (typeof meta.stepId === 'string' && meta.stepId) return meta.stepId
  if (typeof meta.pipelineStepId === 'string' && meta.pipelineStepId) return meta.pipelineStepId
  return undefined
}
