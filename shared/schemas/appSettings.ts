import { z } from 'zod'

/**
 * Client preference object (localStorage).
 * Skeleton + passthrough — later tasks add named fields without changing the storage key.
 */
export const AppSettingsSchema = z
  .object({
    // Reserved names (optional) — UI controls land in later sub-tasks.
    artifactViewMode: z.enum(['block', 'full']).optional(),
    theme: z.enum(['system', 'light', 'dark']).optional(),
    locale: z.enum(['vi', 'en']).optional(),
  })
  .passthrough()

export type AppSettings = z.infer<typeof AppSettingsSchema>
export type ThemePreference = 'system' | 'light' | 'dark'
export type LocalePreference = 'vi' | 'en'

export const DEFAULT_APP_SETTINGS: AppSettings = {}

export function parseAppSettings(raw: unknown): AppSettings {
  const parsed = AppSettingsSchema.safeParse(raw)
  return parsed.success ? parsed.data : { ...DEFAULT_APP_SETTINGS }
}

/** Effective view mode: missing / invalid-at-runtime → 'block'. */
export function resolveArtifactViewMode(
  settings: Pick<AppSettings, 'artifactViewMode'> | null | undefined,
): 'block' | 'full' {
  return settings?.artifactViewMode === 'full' ? 'full' : 'block'
}

/** Effective theme preference: missing → 'system'. */
export function resolveThemePreference(
  settings: Pick<AppSettings, 'theme'> | null | undefined,
): ThemePreference {
  const t = settings?.theme
  if (t === 'light' || t === 'dark' || t === 'system') return t
  return 'system'
}

/** Effective UI locale: missing / invalid-at-runtime → 'vi' (default locale). */
export function resolveLocale(
  settings: Pick<AppSettings, 'locale'> | null | undefined,
): LocalePreference {
  return settings?.locale === 'en' ? 'en' : 'vi'
}
