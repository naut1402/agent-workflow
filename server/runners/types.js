// Shared types for runner execution plane (U0005).

/** @typedef {object} CredentialProfile
 * @property {string} id
 * @property {string} provider
 * @property {string} label
 * @property {string} secretRef
 */

/** @typedef {object} RunnerConfig
 * @property {string} id
 * @property {string} name
 * @property {string} provider
 * @property {string} credentialId
 * @property {boolean} [enabled]
 * @property {number} [maxConcurrency]
 * @property {Record<string, unknown>} config
 */

/** @typedef {object} ResolvedAgent
 * @property {string} ref
 * @property {string} name
 * @property {string} description
 * @property {string} systemPrompt
 * @property {string[]} skills
 * @property {string} [model]
 * @property {string} [agentFilePath]
 */

/** @typedef {object} ExecuteRequest
 * @property {string} jobId
 * @property {ResolvedAgent} resolvedAgent
 * @property {string} userPrompt
 * @property {string} workspace
 * @property {string[]} [produces]
 * @property {number} [timeoutMs]
 * @property {Record<string, unknown>} [metadata]
 */

/** @typedef {object} ExecuteResult
 * @property {boolean} ok
 * @property {number|null} exitCode
 * @property {number} durationMs
 * @property {string} [logPath]
 * @property {string[]} [artifactsFound]
 * @property {string} [error]
 */

/** @typedef {object} JobRecord
 * @property {string} id
 * @property {'queued'|'running'|'succeeded'|'failed'|'cancelled'} status
 * @property {string} runnerId
 * @property {string} agentRef
 * @property {string} workspace
 * @property {string} [userPrompt]
 * @property {string} [promptRef]
 * @property {string[]} [produces]
 * @property {string} createdAt
 * @property {string|null} startedAt
 * @property {string|null} finishedAt
 * @property {number|null} exitCode
 * @property {string} [logPath]
 * @property {string} [error]
 * @property {Record<string, unknown>} [metadata]
 */

export const RUNNERS_VERSION = 1
export const CREDENTIALS_VERSION = 1

export function sanitiseRunnerId(id) {
  if (typeof id !== 'string' || !id.trim()) return null
  if (/[\\/\0]/.test(id)) return null
  const clean = id.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
  return clean || null
}

export function sanitiseCredentialId(id) {
  return sanitiseRunnerId(id)
}
