// Global dashboard settings under ~/.dev-team-dashboard/settings.json.
// Autoscan lives at settings.autoscan; legacy autoscan.json is still read once
// for migration so existing installs keep working.

import { joinPath, mkdirSync, readTextFileSync, writeTextFileAtomicSync } from '../../../core/lib/fileHelper.js'
import {
  DEFAULT_DASHBOARD_SETTINGS,
  parseDashboardSettings,
  resolveAutoscanFromDashboard,
  resolveGithubTokensFromDashboard,
  resolveLoggingFromDashboard,
  resolveRecoveryFromDashboard,
  resolveScanPatternsFromDashboard,
  resolveSecurityFromDashboard,
  type DashboardSettings,
} from '../schemas/dashboardSettings.js'
import {
  DEFAULT_AUTOSCAN_CONFIG,
  parseAutoscanConfig,
  type AutoscanConfig,
} from '../schemas/autoscan.js'
import {
  parseGithubTokensConfig,
  type GithubTokensConfig,
} from '../schemas/githubTokens.js'
import { parseLoggingConfig, type LoggingConfig } from '../../../core/log/loggingPrefs.js'
import { invalidateLoggingPrefsCache } from '../../../core/log/loggingPrefsIo.js'
import { parseRecoverySettings, type RecoverySettings } from '../schemas/recovery.js'
import { parseScanPatternsConfig, type ScanPatternsConfig } from '../schemas/scanPatterns.js'
import { DEFAULT_SECURITY_CONFIG, parseSecurityConfig, type SecurityConfig } from '../schemas/security.js'
import { registryHome } from '../../../core/registry.js'

export function dashboardSettingsFile(): string {
  return joinPath(registryHome(), 'settings.json')
}

/** @deprecated Prefer settings.json — kept for one-time migration read. */
export function autoscanFile(): string {
  return joinPath(registryHome(), 'autoscan.json')
}

function readJsonFile(file: string): unknown | null {
  try {
    return JSON.parse(readTextFileSync(file))
  } catch {
    return null
  }
}

export function loadDashboardSettings(): DashboardSettings {
  const primary = readJsonFile(dashboardSettingsFile())
  if (primary != null) return parseDashboardSettings(primary)

  // Migrate legacy autoscan.json → in-memory settings shape (persisted on next save).
  const legacy = readJsonFile(autoscanFile())
  if (legacy != null) {
    return parseDashboardSettings({
      autoscan: parseAutoscanConfig(legacy),
    })
  }

  return {
    autoscan: { ...DEFAULT_AUTOSCAN_CONFIG, whitelist: [] },
    githubTokens: { repos: [] },
    logging: parseLoggingConfig(undefined),
    recovery: parseRecoverySettings(undefined),
    scanPatterns: parseScanPatternsConfig(undefined),
    security: parseSecurityConfig(undefined),
  }
}

export function saveDashboardSettings(settings: DashboardSettings): DashboardSettings {
  const home = registryHome()
  mkdirSync(home, { recursive: true })
  const normalised = parseDashboardSettings(settings)
  writeTextFileAtomicSync(dashboardSettingsFile(), JSON.stringify(normalised, null, 2))
  invalidateLoggingPrefsCache()
  return normalised
}

export function loadAutoscanConfig(): AutoscanConfig {
  return resolveAutoscanFromDashboard(loadDashboardSettings())
}

export function saveAutoscanConfig(config: AutoscanConfig): AutoscanConfig {
  const current = loadDashboardSettings()
  const normalised: AutoscanConfig = {
    enabled: Boolean(config.enabled),
    whitelist: Array.isArray(config.whitelist)
      ? [...new Set(config.whitelist.map((p) => String(p).trim()).filter(Boolean))]
      : [],
    intervalMs: config.intervalMs ?? DEFAULT_AUTOSCAN_CONFIG.intervalMs,
  }
  const saved = saveDashboardSettings({
    ...current,
    autoscan: normalised,
  })
  return resolveAutoscanFromDashboard(saved)
}

export function loadGithubTokensConfig(): GithubTokensConfig {
  return resolveGithubTokensFromDashboard(loadDashboardSettings())
}

export function saveGithubTokensConfig(config: GithubTokensConfig): GithubTokensConfig {
  const current = loadDashboardSettings()
  const normalised = parseGithubTokensConfig(config)
  const saved = saveDashboardSettings({
    ...current,
    githubTokens: normalised,
  })
  return resolveGithubTokensFromDashboard(saved)
}

export function loadLoggingConfig(): LoggingConfig {
  return resolveLoggingFromDashboard(loadDashboardSettings())
}

export function saveLoggingConfig(config: LoggingConfig): LoggingConfig {
  const current = loadDashboardSettings()
  const normalised = parseLoggingConfig(config)
  const saved = saveDashboardSettings({
    ...current,
    logging: normalised,
  })
  return resolveLoggingFromDashboard(saved)
}

export function loadRecoverySettings(): RecoverySettings {
  return resolveRecoveryFromDashboard(loadDashboardSettings())
}

export function saveRecoverySettings(config: RecoverySettings): RecoverySettings {
  const current = loadDashboardSettings()
  const normalised = parseRecoverySettings(config)
  const saved = saveDashboardSettings({
    ...current,
    recovery: normalised,
  })
  return resolveRecoveryFromDashboard(saved)
}

export function loadScanPatternsConfig(): ScanPatternsConfig {
  return resolveScanPatternsFromDashboard(loadDashboardSettings())
}

export function saveScanPatternsConfig(config: ScanPatternsConfig): ScanPatternsConfig {
  const current = loadDashboardSettings()
  const normalised = parseScanPatternsConfig(config)
  const saved = saveDashboardSettings({
    ...current,
    scanPatterns: normalised,
  })
  return resolveScanPatternsFromDashboard(saved)
}

export function loadSecurityConfig(): SecurityConfig {
  return resolveSecurityFromDashboard(loadDashboardSettings())
}

export function saveSecurityConfig(config: SecurityConfig): SecurityConfig {
  const current = loadDashboardSettings()
  const normalised = parseSecurityConfig(config)
  const saved = saveDashboardSettings({
    ...current,
    security: normalised,
  })
  return resolveSecurityFromDashboard(saved)
}

// Re-export default shape for callers that only need the empty template.
export { DEFAULT_DASHBOARD_SETTINGS, DEFAULT_SECURITY_CONFIG }
