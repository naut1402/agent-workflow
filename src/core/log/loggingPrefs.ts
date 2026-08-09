import { z } from 'zod'
import { joinPath, readTextFileSync } from '../lib/fileHelper.js'
import { registryHome } from '../registry.js'

/**
 * Logging prefs in `~/.dev-team-dashboard/settings.json` (`logging` key).
 * Owned here so `core/log` write path can gate without importing features.
 */

export const LoggingTypesSchema = z.object({
  audit: z.boolean().optional(),
  request: z.boolean().optional(),
  jobs: z.boolean().optional(),
  /** Domain events JSONL — default on (quan sát bus trên Logs). */
  events: z.boolean().optional(),
})

export const LoggingConfigSchema = z
  .object({
    showLogsTab: z.boolean().optional(),
    types: LoggingTypesSchema.optional(),
  })
  .passthrough()

export type LoggingTypes = {
  audit: boolean
  request: boolean
  jobs: boolean
  events: boolean
}

export type LoggingConfig = {
  showLogsTab: boolean
  types: LoggingTypes
}

export type LoggingTypeKey = keyof LoggingTypes

export const DEFAULT_LOGGING_CONFIG: LoggingConfig = {
  showLogsTab: true,
  types: { audit: true, request: true, jobs: true, events: true },
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
      events: d.types?.events !== false,
    },
  }
}

function settingsFilePath(): string {
  return joinPath(registryHome(), 'settings.json')
}

let cached: LoggingConfig | null = null
let cachedMtime = 0

/** Drop in-memory cache (call after saving settings.json). */
export function invalidateLoggingPrefsCache(): void {
  cached = null
  cachedMtime = 0
}

/**
 * Read logging prefs from settings.json. Missing/invalid → all enabled.
 * Small file; caches until invalidate or mtime changes.
 */
export function loadLoggingPrefs(): LoggingConfig {
  try {
    const file = settingsFilePath()
    const rawText = readTextFileSync(file)
    // Cheap fingerprint: length + first/last chars — avoid importing stat just for cache.
    // Prefer re-read; invalidateLoggingPrefsCache after writes is the primary path.
    if (cached && cachedMtime === rawText.length) return cached
    const json = JSON.parse(rawText) as { logging?: unknown }
    cached = parseLoggingConfig(json?.logging)
    cachedMtime = rawText.length
    return cached
  } catch {
    return { ...DEFAULT_LOGGING_CONFIG, types: { ...DEFAULT_LOGGING_CONFIG.types } }
  }
}

/** Whether a log type should be written / shown. */
export function isLogTypeEnabled(type: LoggingTypeKey): boolean {
  return loadLoggingPrefs().types[type] !== false
}

export function resolveShowLogsTab(prefs: LoggingConfig | null | undefined): boolean {
  return prefs?.showLogsTab !== false
}
