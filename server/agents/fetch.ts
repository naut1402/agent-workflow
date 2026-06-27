import { isPrivateHostname } from '../../shared/sanitize.js'

/**
 * Fetch a user-supplied URL safely: https only, blocks private hosts (SSRF),
 * 15s timeout, 512KB cap. Reuse for any outbound fetch of user URLs.
 */
export async function fetchUrlSafe(urlStr: string): Promise<string> {
  let u: URL
  try {
    u = new URL(urlStr)
  } catch {
    throw new Error('invalid URL')
  }
  if (u.protocol !== 'https:') throw new Error('only https URLs allowed')
  if (isPrivateHostname(u.hostname)) throw new Error('private hosts not allowed')
  const res = await fetch(urlStr, { redirect: 'follow', signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
  const text = await res.text()
  if (text.length > 512_000) throw new Error('response too large')
  return text
}
