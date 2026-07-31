import { isPrivateHostname } from '../../../core/contracts/sanitize.js'

export interface FetchUrlSafeOptions {
  /** Extra request headers (e.g. API Accept / Authorization). */
  headers?: Record<string, string>
}

/**
 * Fetch a user-supplied URL safely: https only, blocks private hosts (SSRF),
 * 15s timeout, 512KB cap. Reuse for any outbound fetch of user URLs.
 */
export async function fetchUrlSafe(
  urlStr: string,
  options?: FetchUrlSafeOptions,
): Promise<string> {
  let u: URL
  try {
    u = new URL(urlStr)
  } catch {
    throw new Error('invalid URL')
  }
  if (u.protocol !== 'https:') throw new Error('only https URLs allowed')
  if (isPrivateHostname(u.hostname)) throw new Error('private hosts not allowed')
  const res = await fetch(urlStr, {
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
    ...(options?.headers ? { headers: options.headers } : {}),
  })
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
  const text = await res.text()
  if (text.length > 512_000) throw new Error('response too large')
  return text
}
