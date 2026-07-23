// Global dashboard settings under ~/.dev-team-dashboard/settings.json.
// Autoscan lives at settings.autoscan; legacy autoscan.json is still read once
// for migration so existing installs keep working.

import fs from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_DASHBOARD_SETTINGS,
  parseDashboardSettings,
  resolveAutoscanFromDashboard,
  type DashboardSettings,
} from '../../shared/schemas/dashboardSettings.js'
import {
  DEFAULT_AUTOSCAN_CONFIG,
  parseAutoscanConfig,
  type AutoscanConfig,
} from '../../shared/schemas/autoscan.js'
import { registryHome } from '../registry.js'

export function dashboardSettingsFile(): string {
  return path.join(registryHome(), 'settings.json')
}

/** @deprecated Prefer settings.json — kept for one-time migration read. */
export function autoscanFile(): string {
  return path.join(registryHome(), 'autoscan.json')
}

function readJsonFile(file: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
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
  }
}

export function saveDashboardSettings(settings: DashboardSettings): DashboardSettings {
  const home = registryHome()
  fs.mkdirSync(home, { recursive: true })
  const normalised = parseDashboardSettings(settings)
  const file = dashboardSettingsFile()
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(normalised, null, 2), 'utf8')
  fs.renameSync(tmp, file)
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

// Re-export default shape for callers that only need the empty template.
export { DEFAULT_DASHBOARD_SETTINGS }
