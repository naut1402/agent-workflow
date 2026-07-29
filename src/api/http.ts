// Shared fetch plumbing used by every `src/api/resources/*.ts` file.

import { getApiToken } from '../shared/lib/authToken.js'

// Build a query string from key/value pairs, dropping null/undefined/empty and
// URL-encoding values. Used to append the optional `?project=<id>` selector.
export function qs(params: Record<string, any> | null | undefined): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(params || {})) {
    if (v === null || v === undefined || v === '') continue
    parts.push(`${k}=${encodeURIComponent(v)}`)
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

// Auth-aware fetch: attaches the API token when one is configured, else falls
// back to a plain fetch (offline / no-token mode).
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const token = getApiToken()
  if (!token) return fetch(input, init)

  const headers = new Headers(init.headers || {})
  if (!headers.has('Authorization') && !headers.has('X-Dev-Team-Token')) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  return fetch(input, { ...init, headers })
}
