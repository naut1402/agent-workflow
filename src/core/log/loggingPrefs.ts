import { z } from 'zod'

/**
 * Logging prefs schema + parse (browser-safe).
 * FS read of settings.json lives in `loggingPrefsIo.ts` — do not import Node I/O here
 * (Vite client / shared schemas must stay free of `fileHelper`).
 */

export const LoggingTypesSchema = z.object({
  audit: z.boolean().optional(),
  request: z.boolean().optional(),
  jobs: z.boolean().optional(),
  /** Domain events JSONL — opt-in (default off; volume/noise when debugging). */
  events: z.boolean().optional(),
  usage: z.boolean().optional(),
})

/** Storage backends for the log write/read path (design.md B202608_2201 §3.1). */
export const LOG_DRIVER_KINDS = ['file', 'sqlite'] as const
export type LogDriverKind = (typeof LOG_DRIVER_KINDS)[number]

export const LoggingConfigSchema = z
  .object({
    showLogsTab: z.boolean().optional(),
    types: LoggingTypesSchema.optional(),
    /** Log storage backend — invalid/missing falls back to `'file'`. */
    driver: z.enum(LOG_DRIVER_KINDS).optional(),
  })
  .passthrough()

export type LoggingTypes = {
  audit: boolean
  request: boolean
  jobs: boolean
  events: boolean
  usage: boolean
}

export type LoggingConfig = {
  showLogsTab: boolean
  types: LoggingTypes
  driver: LogDriverKind
}

export type LoggingTypeKey = keyof LoggingTypes

export const DEFAULT_LOGGING_CONFIG: LoggingConfig = {
  showLogsTab: true,
  types: { audit: true, request: true, jobs: true, events: false, usage: true },
  driver: 'file',
}

export function parseLoggingConfig(raw: unknown): LoggingConfig {
  const parsed = LoggingConfigSchema.safeParse(raw ?? {})
  if (!parsed.success) return { ...DEFAULT_LOGGING_CONFIG, types: { ...DEFAULT_LOGGING_CONFIG.types } }
  const d = parsed.data
  return {
    showLogsTab: d.showLogsTab !== false,
    types: {
      audit: d.types?.audit !== false,
      request: d.types?.request !== false,
      jobs: d.types?.jobs !== false,
      // Opt-in: missing/undefined → off (unlike audit/request/jobs).
      events: d.types?.events === true,
      usage: d.types?.usage !== false,
    },
    driver: d.driver === 'sqlite' ? 'sqlite' : 'file',
  }
}

export function resolveShowLogsTab(prefs: LoggingConfig | null | undefined): boolean {
  return prefs?.showLogsTab !== false
}
