import path from 'node:path'

/**
 * Sanitise a pipeline/flow profile name: rejects path separators and null bytes,
 * strips disallowed characters, caps at 64 chars. Returns null when invalid/empty.
 */
export function sanitiseProfileName(name: unknown): string | null {
  if (typeof name !== 'string' || !name.trim()) return null
  // Reject names containing path separators or null bytes.
  if (/[\\/\0]/.test(name)) return null
  const clean = name.trim().replace(/[^a-zA-Z0-9_\-. ]/g, '').slice(0, 64)
  return clean || null
}

/** Sanitise an agent name (stricter charset than profile names). */
export function sanitiseAgentName(name: unknown): string | null {
  if (typeof name !== 'string' || !name.trim()) return null
  if (/[\\/\0]/.test(name)) return null
  const clean = name.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
  return clean || null
}

/**
 * Resolve an artifact path under `<root>/tasks/<id>/<name>`, guarding against
 * path traversal. Returns null if the resolved path escapes the task directory.
 */
export function resolveArtifact(root: string, id: string, name: string): string | null {
  const taskDir = path.resolve(root, 'tasks', id)
  const target = path.resolve(taskDir, name)
  if (target !== taskDir && !target.startsWith(taskDir + path.sep)) return null
  return target
}

/**
 * Validate a job id. Job ids are minted with `crypto.randomUUID()`, so a strict
 * UUID-v4 shape both matches real ids and rejects path traversal (no separators,
 * dots or null bytes can pass). Returns the lower-cased id, or null when invalid.
 */
export function sanitiseJobId(id: unknown): string | null {
  if (typeof id !== 'string') return null
  const v = id.trim().toLowerCase()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)) return null
  return v
}

/** True for hostnames that resolve to private / loopback ranges (SSRF guard). */
export function isPrivateHostname(hostname: string): boolean {
  const h = (hostname || '').toLowerCase()
  if (h === 'localhost' || h.endsWith('.local')) return true
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true
  return false
}
