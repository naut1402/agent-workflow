import { joinPath, readTextFileSync } from '../lib/fileHelper.js'
import { registryHome } from '../registry.js'
import {
  DEFAULT_LOGGING_CONFIG,
  parseLoggingConfig,
  type LoggingConfig,
  type LoggingTypeKey,
  type LogDriverKind,
} from '../../shared/log/loggingPrefs.js'

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
 * Read logging prefs from settings.json. Missing/invalid → defaults.
 * Small file; caches until invalidated or the file length changes.
 */
export function loadLoggingPrefs(): LoggingConfig {
  try {
    const file = settingsFilePath()
    const rawText = readTextFileSync(file)
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

/** Configured log storage backend — defaults to `'file'`. */
export function getLogDriverPref(): LogDriverKind {
  return loadLoggingPrefs().driver
}
