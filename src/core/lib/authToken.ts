const STORAGE_KEY = 'dev-team-api-token'

export function getApiToken(): string | null {
  try {
    const v = globalThis?.localStorage?.getItem?.(STORAGE_KEY) ?? null
    const trimmed = typeof v === 'string' ? v.trim() : ''
    return trimmed ? trimmed : null
  } catch {
    return null
  }
}

export function setApiToken(token: string): void {
  try {
    const trimmed = token.trim()
    if (!trimmed) return
    globalThis?.localStorage?.setItem?.(STORAGE_KEY, trimmed)
  } catch {
    // ignore (storage not available)
  }
}

export function clearApiToken(): void {
  try {
    globalThis?.localStorage?.removeItem?.(STORAGE_KEY)
  } catch {
    // ignore (storage not available)
  }
}

