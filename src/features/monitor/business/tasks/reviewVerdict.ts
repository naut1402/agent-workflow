import { readTextFile } from '../../../../core/lib/fileHelper.js'
import { resolveArtifact } from './index.js'

/**
 * Parse a review-style step's artifact for its `Recommendation:` line and
 * decide whether the step's `hitl.retry` should fire. Fail-safe by design —
 * any read/parse miss returns `{ retry: false }` so a step without a working
 * verdict line falls back to the pre-existing advance/gate behavior instead
 * of getting stuck.
 */
export async function checkReviewRetry(
  root: string,
  taskId: string,
  step: { produces?: string[] },
): Promise<{ retry: boolean }> {
  const artifactName = step.produces?.[0]
  if (!artifactName) return { retry: false }

  const artifactPath = resolveArtifact(root, taskId, artifactName)
  if (!artifactPath) return { retry: false }

  try {
    const text = await readTextFile(artifactPath)
    const match = /Recommendation:\s*(\S+)/i.exec(text)
    if (!match) return { retry: false }
    const verdict = match[1].toUpperCase()
    const isApprove = verdict.startsWith('APPROVE')
    return { retry: !isApprove }
  } catch {
    return { retry: false }
  }
}
