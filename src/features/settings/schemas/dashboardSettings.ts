import { z } from 'zod'
import {
  AutoscanConfigSchema,
  DEFAULT_AUTOSCAN_CONFIG,
  parseAutoscanConfig,
  type AutoscanConfig,
} from './autoscan'
import {
  DEFAULT_GITHUB_TOKENS_CONFIG,
  GithubTokensConfigSchema,
  parseGithubTokensConfig,
  type GithubTokensConfig,
} from './githubTokens'
import {
  DEFAULT_LOGGING_CONFIG,
  LoggingConfigSchema,
  parseLoggingConfig,
  type LoggingConfig,
} from '../../../core/log/loggingPrefs'
import {
  DEFAULT_RECOVERY_SETTINGS,
  RecoverySettingsSchema,
  parseRecoverySettings,
  type RecoverySettings,
} from './recovery'
import {
  DEFAULT_SCAN_PATTERNS_CONFIG,
  ScanPatternsConfigSchema,
  parseScanPatternsConfig,
  type ScanPatternsConfig,
} from './scanPatterns'
import {
  DEFAULT_SECURITY_CONFIG,
  SecurityConfigSchema,
  parseSecurityConfig,
  type SecurityConfig,
} from './security'

/**
 * Server-global dashboard settings (`~/.dev-team-dashboard/settings.json`).
 * Nest server-side prefs here (autoscan, githubTokens, logging, recovery, …). Client UI prefs stay in localStorage.
 */
export const DashboardSettingsSchema = z
  .object({
    autoscan: AutoscanConfigSchema.optional(),
    githubTokens: GithubTokensConfigSchema.optional(),
    logging: LoggingConfigSchema.optional(),
    recovery: RecoverySettingsSchema.optional(),
    scanPatterns: ScanPatternsConfigSchema.optional(),
    security: SecurityConfigSchema.optional(),
  })
  .passthrough()

export type DashboardSettings = z.infer<typeof DashboardSettingsSchema>

export const DEFAULT_DASHBOARD_SETTINGS: DashboardSettings = {
  autoscan: { ...DEFAULT_AUTOSCAN_CONFIG, whitelist: [] },
  githubTokens: { ...DEFAULT_GITHUB_TOKENS_CONFIG, repos: [] },
  logging: { ...DEFAULT_LOGGING_CONFIG, types: { ...DEFAULT_LOGGING_CONFIG.types } },
  recovery: { ...DEFAULT_RECOVERY_SETTINGS, backoffMs: [...DEFAULT_RECOVERY_SETTINGS.backoffMs!] },
  scanPatterns: { ...DEFAULT_SCAN_PATTERNS_CONFIG, agents: [], skills: [], rules: [] },
  security: { rateLimit: { ...DEFAULT_SECURITY_CONFIG.rateLimit! }, cors: { ...DEFAULT_SECURITY_CONFIG.cors! } },
}

export function parseDashboardSettings(raw: unknown): DashboardSettings {
  const parsed = DashboardSettingsSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      autoscan: { ...DEFAULT_AUTOSCAN_CONFIG, whitelist: [] },
      githubTokens: { repos: [] },
      logging: { ...DEFAULT_LOGGING_CONFIG, types: { ...DEFAULT_LOGGING_CONFIG.types } },
      recovery: { ...DEFAULT_RECOVERY_SETTINGS, backoffMs: [...DEFAULT_RECOVERY_SETTINGS.backoffMs!] },
      scanPatterns: { ...DEFAULT_SCAN_PATTERNS_CONFIG, agents: [], skills: [], rules: [] },
      security: { rateLimit: { ...DEFAULT_SECURITY_CONFIG.rateLimit! }, cors: { ...DEFAULT_SECURITY_CONFIG.cors! } },
    }
  }
  return {
    ...parsed.data,
    autoscan: parseAutoscanConfig(parsed.data.autoscan ?? DEFAULT_AUTOSCAN_CONFIG),
    githubTokens: parseGithubTokensConfig(parsed.data.githubTokens ?? DEFAULT_GITHUB_TOKENS_CONFIG),
    logging: parseLoggingConfig(parsed.data.logging ?? DEFAULT_LOGGING_CONFIG),
    recovery: parseRecoverySettings(parsed.data.recovery ?? DEFAULT_RECOVERY_SETTINGS),
    scanPatterns: parseScanPatternsConfig(parsed.data.scanPatterns ?? DEFAULT_SCAN_PATTERNS_CONFIG),
    security: parseSecurityConfig(parsed.data.security ?? DEFAULT_SECURITY_CONFIG),
  }
}

export function resolveAutoscanFromDashboard(
  settings: DashboardSettings | null | undefined,
): AutoscanConfig {
  return parseAutoscanConfig(settings?.autoscan ?? DEFAULT_AUTOSCAN_CONFIG)
}

export function resolveGithubTokensFromDashboard(
  settings: DashboardSettings | null | undefined,
): GithubTokensConfig {
  return parseGithubTokensConfig(settings?.githubTokens ?? DEFAULT_GITHUB_TOKENS_CONFIG)
}

export function resolveLoggingFromDashboard(
  settings: DashboardSettings | null | undefined,
): LoggingConfig {
  return parseLoggingConfig(settings?.logging ?? DEFAULT_LOGGING_CONFIG)
}

export function resolveRecoveryFromDashboard(
  settings: DashboardSettings | null | undefined,
): RecoverySettings {
  return parseRecoverySettings(settings?.recovery ?? DEFAULT_RECOVERY_SETTINGS)
}

export function resolveScanPatternsFromDashboard(
  settings: DashboardSettings | null | undefined,
): ScanPatternsConfig {
  return parseScanPatternsConfig(settings?.scanPatterns ?? DEFAULT_SCAN_PATTERNS_CONFIG)
}

export function resolveSecurityFromDashboard(
  settings: DashboardSettings | null | undefined,
): SecurityConfig {
  return parseSecurityConfig(settings?.security ?? DEFAULT_SECURITY_CONFIG)
}
