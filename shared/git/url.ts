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
