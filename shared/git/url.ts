import { isPrivateHostname } from '../sanitize.js'

export type ValidateGitUrlResult =
  | { ok: true; url: string; normalizedUrl: string }
  | { ok: false; error: string }

export function validateGitUrl(urlStr: string): ValidateGitUrlResult {
  const trimmed = urlStr.trim()
  if (!trimmed) return { ok: false, error: 'gitUrl is required' }
  let u: URL
  try {
    u = new URL(trimmed)
  } catch {
    return { ok: false, error: 'invalid URL' }
  }
  if (u.protocol !== 'https:') return { ok: false, error: 'only https URLs allowed' }
  if (isPrivateHostname(u.hostname)) return { ok: false, error: 'private hosts not allowed' }
  const normalizedUrl = u.origin + u.pathname.replace(/\/$/, '') + u.search
  return { ok: true, url: trimmed, normalizedUrl }
}

/**
 * Normalize a git remote URL for equality checks (HTTPS or SCP-like SSH).
 * Strips trailing `.git`, lowercases host, drops credentials/query/fragment.
 * Returns null when the input cannot be parsed into host+path.
 */
export function normalizeGitUrlForMatch(urlStr: string): string | null {
  const trimmed = (urlStr || '').trim()
  if (!trimmed) return null

  const scp = trimmed.match(/^git@([^:]+):(.+)$/i)
  if (scp) {
    const host = scp[1].toLowerCase()
    const repoPath = scp[2].replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '')
    if (!host || !repoPath) return null
    return `${host}/${repoPath}`.toLowerCase()
  }

  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
    const u = new URL(withScheme)
    const host = u.hostname.toLowerCase()
    const repoPath = u.pathname.replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '')
    if (!host || !repoPath) return null
    return `${host}/${repoPath}`.toLowerCase()
  } catch {
    return null
  }
}
