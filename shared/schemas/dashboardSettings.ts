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

/**
 * Server-global dashboard settings (`~/.dev-team-dashboard/settings.json`).
 * Nest server-side prefs here (autoscan, githubTokens, …). Client UI prefs stay in localStorage.
 */
export const DashboardSettingsSchema = z
  .object({
    autoscan: AutoscanConfigSchema.optional(),
    githubTokens: GithubTokensConfigSchema.optional(),
  })
  .passthrough()

export type DashboardSettings = z.infer<typeof DashboardSettingsSchema>

export const DEFAULT_DASHBOARD_SETTINGS: DashboardSettings = {
  autoscan: { ...DEFAULT_AUTOSCAN_CONFIG, whitelist: [] },
  githubTokens: { ...DEFAULT_GITHUB_TOKENS_CONFIG, repos: [] },
}

export function parseDashboardSettings(raw: unknown): DashboardSettings {
  const parsed = DashboardSettingsSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      autoscan: { ...DEFAULT_AUTOSCAN_CONFIG, whitelist: [] },
      githubTokens: { repos: [] },
    }
  }
  return {
    ...parsed.data,
    autoscan: parseAutoscanConfig(parsed.data.autoscan ?? DEFAULT_AUTOSCAN_CONFIG),
    githubTokens: parseGithubTokensConfig(parsed.data.githubTokens ?? DEFAULT_GITHUB_TOKENS_CONFIG),
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
