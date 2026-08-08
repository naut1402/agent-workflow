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
  DEFAULT_KNOWLEDGE_SCAN_CONFIG,
  KnowledgeScanConfigSchema,
  parseKnowledgeScanConfig,
  type KnowledgeScanConfig,
} from './knowledgeScan'

/**
 * Server-global dashboard settings (`~/.dev-team-dashboard/settings.json`).
 * Nest server-side prefs here (autoscan, githubTokens, logging, …). Client UI prefs stay in localStorage.
 */
export const DashboardSettingsSchema = z
  .object({
    autoscan: AutoscanConfigSchema.optional(),
    githubTokens: GithubTokensConfigSchema.optional(),
    logging: LoggingConfigSchema.optional(),
    knowledgeScan: KnowledgeScanConfigSchema.optional(),
  })
  .passthrough()

export type DashboardSettings = z.infer<typeof DashboardSettingsSchema>

export const DEFAULT_DASHBOARD_SETTINGS: DashboardSettings = {
  autoscan: { ...DEFAULT_AUTOSCAN_CONFIG, whitelist: [] },
  githubTokens: { ...DEFAULT_GITHUB_TOKENS_CONFIG, repos: [] },
  logging: { ...DEFAULT_LOGGING_CONFIG, types: { ...DEFAULT_LOGGING_CONFIG.types } },
  knowledgeScan: {
    ...DEFAULT_KNOWLEDGE_SCAN_CONFIG,
    whitelist: [...DEFAULT_KNOWLEDGE_SCAN_CONFIG.whitelist],
  },
}

export function parseDashboardSettings(raw: unknown): DashboardSettings {
  const parsed = DashboardSettingsSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      autoscan: { ...DEFAULT_AUTOSCAN_CONFIG, whitelist: [] },
      githubTokens: { repos: [] },
      logging: { ...DEFAULT_LOGGING_CONFIG, types: { ...DEFAULT_LOGGING_CONFIG.types } },
      knowledgeScan: {
        ...DEFAULT_KNOWLEDGE_SCAN_CONFIG,
        whitelist: [...DEFAULT_KNOWLEDGE_SCAN_CONFIG.whitelist],
      },
    }
  }
  return {
    ...parsed.data,
    autoscan: parseAutoscanConfig(parsed.data.autoscan ?? DEFAULT_AUTOSCAN_CONFIG),
    githubTokens: parseGithubTokensConfig(parsed.data.githubTokens ?? DEFAULT_GITHUB_TOKENS_CONFIG),
    logging: parseLoggingConfig(parsed.data.logging ?? DEFAULT_LOGGING_CONFIG),
    knowledgeScan: parseKnowledgeScanConfig(
      parsed.data.knowledgeScan ?? DEFAULT_KNOWLEDGE_SCAN_CONFIG,
    ),
  }
}

export function resolveKnowledgeScanFromDashboard(
  settings: DashboardSettings | null | undefined,
): KnowledgeScanConfig {
  return parseKnowledgeScanConfig(settings?.knowledgeScan ?? DEFAULT_KNOWLEDGE_SCAN_CONFIG)
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
