import type { ExecuteResult, JobFailureKind } from './types.js'

export type { JobFailureKind }

const USAGE_RE = /usage\s*limit|rate\s*limit|\b429\b|quota|too many requests|overloaded|capacity/i
const NETWORK_RE =
  /ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|network|fetch failed|socket hang up|offline|getaddrinfo/i
const RESET_AT_RE = /resets?\s+(?:at|in)\s+([^\n.]+)/i

export function classifyJobFailure(result: ExecuteResult): JobFailureKind | null {
  if (result.ok) return null
  const err = (result.error ?? '').trim()
  const blob = err

  if (result.exitCode === null) {
    if (NETWORK_RE.test(blob)) return 'network'
    return 'process_crash'
  }

  if (/process timed out/i.test(blob)) return 'process_crash'

  if (USAGE_RE.test(blob)) return 'usage_limit'

  if (NETWORK_RE.test(blob)) return 'network'

  return null
}

/** Optional: parse reset time from usage-limit stderr. */
export function parseUsageResetAt(error: string): Date | null {
  const m = RESET_AT_RE.exec(error)
  if (!m?.[1]) return null
  const parsed = Date.parse(m[1].trim())
  if (Number.isNaN(parsed)) return null
  return new Date(parsed)
}
