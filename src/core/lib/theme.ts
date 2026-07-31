import type { AppSettings } from '../contracts/schemas/appSettings'
import { resolveThemePreference } from '../contracts/schemas/appSettings'

export type ResolvedTheme = 'light' | 'dark'
export type ThemePreference = 'system' | 'light' | 'dark'

/** Resolve preference → concrete light|dark (system follows OS). */
export function resolveThemeToDataAttr(pref: ThemePreference): ResolvedTheme {
  if (pref === 'light') return 'light'
  if (pref === 'dark') return 'dark'
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'dark'
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Set `data-theme` on `<html>` from preference (or settings object). */
export function applyThemeToDocument(
  prefOrSettings: ThemePreference | Pick<AppSettings, 'theme'> | null | undefined,
): ResolvedTheme {
  const pref =
    typeof prefOrSettings === 'string'
      ? prefOrSettings
      : resolveThemePreference(prefOrSettings)
  const resolved = resolveThemeToDataAttr(pref)
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', resolved)
  }
  return resolved
}

/**
 * Listen for OS color-scheme changes. Caller should re-apply only when
 * preference is `system`. Returns unsubscribe.
 */
export function watchSystemTheme(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {}
  }
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = () => onChange()
  mq.addEventListener('change', handler)
  return () => mq.removeEventListener('change', handler)
}
