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
    hideMissingArtifacts: z.boolean().optional(),
    collapseTaskExpandOnOutside: z.boolean().optional(),
    collapseAppSidebarOnOutside: z.boolean().optional(),
    collapseMonitorSubSidebarOnOutside: z.boolean().optional(),
    notificationsEnabled: z.boolean().optional(),
    notifyHitlPending: z.boolean().optional(),
    notifyQaReady: z.boolean().optional(),
    notifyBrowserEnabled: z.boolean().optional(),
    notifySoundEnabled: z.boolean().optional(),
    /** Where to show notification UI icons. Missing → 'both'. */
    notificationUiPlacement: z.enum(['sidebar', 'floating', 'both']).optional(),
    /** Feedback while a step's job is running: wait for it, or cancel + resume now. Missing → 'queue'. */
    chatFeedbackMode: z.enum(['queue', 'immediate']).optional(),
    /** Enter in the chat composer sends the message (true) or inserts a newline (false). Missing → true. */
    chatEnterToSend: z.boolean().optional(),
  })
  .passthrough()

export type AppSettings = z.infer<typeof AppSettingsSchema>
export type ThemePreference = 'system' | 'light' | 'dark'
export type LocalePreference = 'vi' | 'en'
export type NotificationUiPlacement = 'sidebar' | 'floating' | 'both'
export type ChatFeedbackMode = 'queue' | 'immediate'

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

/** Effective "hide missing artifacts" preference: missing → true (hide by default). */
export function resolveHideMissingArtifacts(
  settings: Pick<AppSettings, 'hideMissingArtifacts'> | null | undefined,
): boolean {
  return settings?.hideMissingArtifacts !== false
}

/** Effective "collapse task file-list on outside click" preference: missing → false. */
export function resolveCollapseTaskExpandOnOutside(
  settings: Pick<AppSettings, 'collapseTaskExpandOnOutside'> | null | undefined,
): boolean {
  return settings?.collapseTaskExpandOnOutside === true
}

/** Effective "collapse main app sidebar on outside click" preference: missing → false. */
export function resolveCollapseAppSidebarOnOutside(
  settings: Pick<AppSettings, 'collapseAppSidebarOnOutside'> | null | undefined,
): boolean {
  return settings?.collapseAppSidebarOnOutside === true
}

/** Effective "collapse monitor sub-sidebar on outside click" preference: missing → false. */
export function resolveCollapseMonitorSubSidebarOnOutside(
  settings: Pick<AppSettings, 'collapseMonitorSubSidebarOnOutside'> | null | undefined,
): boolean {
  return settings?.collapseMonitorSubSidebarOnOutside === true
}

/** Effective "notifications enabled" (master switch): missing → true. */
export function resolveNotificationsEnabled(
  settings: Pick<AppSettings, 'notificationsEnabled'> | null | undefined,
): boolean {
  return settings?.notificationsEnabled !== false
}

/** Effective "notify on HITL pending" preference: missing → true. */
export function resolveNotifyHitlPending(
  settings: Pick<AppSettings, 'notifyHitlPending'> | null | undefined,
): boolean {
  return settings?.notifyHitlPending !== false
}

/** Effective "notify on QA ready" preference: missing → true. */
export function resolveNotifyQaReady(
  settings: Pick<AppSettings, 'notifyQaReady'> | null | undefined,
): boolean {
  return settings?.notifyQaReady !== false
}

/** Effective "browser (native) notification" preference: missing → false (opt-in, needs OS permission). */
export function resolveNotifyBrowserEnabled(
  settings: Pick<AppSettings, 'notifyBrowserEnabled'> | null | undefined,
): boolean {
  return settings?.notifyBrowserEnabled === true
}

/** Effective "notification sound" preference: missing → false (opt-in). */
export function resolveNotifySoundEnabled(
  settings: Pick<AppSettings, 'notifySoundEnabled'> | null | undefined,
): boolean {
  return settings?.notifySoundEnabled === true
}

/** Effective notification UI placement: missing / invalid → 'both'. */
export function resolveNotificationUiPlacement(
  settings: Pick<AppSettings, 'notificationUiPlacement'> | null | undefined,
): NotificationUiPlacement {
  const p = settings?.notificationUiPlacement
  if (p === 'sidebar' || p === 'floating' || p === 'both') return p
  return 'both'
}

/** Effective "show notification bell in sidebar". */
export function resolveNotifyShowSidebar(
  settings: Pick<AppSettings, 'notificationUiPlacement'> | null | undefined,
): boolean {
  const p = resolveNotificationUiPlacement(settings)
  return p === 'sidebar' || p === 'both'
}

/** Effective "show floating notification icon". */
export function resolveNotifyShowFloating(
  settings: Pick<AppSettings, 'notificationUiPlacement'> | null | undefined,
): boolean {
  const p = resolveNotificationUiPlacement(settings)
  return p === 'floating' || p === 'both'
}

/** Effective chat feedback mode: missing / invalid → 'queue' (safest default). */
export function resolveChatFeedbackMode(
  settings: Pick<AppSettings, 'chatFeedbackMode'> | null | undefined,
): ChatFeedbackMode {
  return settings?.chatFeedbackMode === 'immediate' ? 'immediate' : 'queue'
}

/** Effective "Enter sends the message" preference: missing → true (keeps the previous behaviour). */
export function resolveChatEnterToSend(
  settings: Pick<AppSettings, 'chatEnterToSend'> | null | undefined,
): boolean {
  return settings?.chatEnterToSend !== false
}
