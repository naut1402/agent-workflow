import { getApiToken } from '../core/lib/authToken.js'

/** Query string helper — bỏ null/undefined/'' và encode value (`?project=`). */
export function qs(params: Record<string, any> | null | undefined): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(params || {})) {
    if (v === null || v === undefined || v === '') continue
    parts.push(`${k}=${encodeURIComponent(v)}`)
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

/** Fetch có token khi cấu hình; không token → fetch thường. */
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const token = getApiToken()
  if (!token) return fetch(input, init)

  const headers = new Headers(init.headers || {})
  if (!headers.has('Authorization') && !headers.has('X-Dev-Team-Token')) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  return fetch(input, { ...init, headers })
}
