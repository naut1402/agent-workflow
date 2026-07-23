// Persist autoscan settings next to projects.json under the dashboard home.

import fs from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_AUTOSCAN_CONFIG,
  parseAutoscanConfig,
  type AutoscanConfig,
} from '../../shared/schemas/autoscan.js'
import { registryHome } from '../registry.js'

export function autoscanFile(): string {
  return path.join(registryHome(), 'autoscan.json')
}

export function loadAutoscanConfig(): AutoscanConfig {
  const file = autoscanFile()
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return { ...DEFAULT_AUTOSCAN_CONFIG, whitelist: [] }
  }
  try {
    return parseAutoscanConfig(JSON.parse(raw))
  } catch {
    console.warn(`[dev-team-dashboard] autoscan.json corrupt, treating as default: ${file}`)
    return { ...DEFAULT_AUTOSCAN_CONFIG, whitelist: [] }
  }
}

export function saveAutoscanConfig(config: AutoscanConfig): AutoscanConfig {
  const home = registryHome()
  fs.mkdirSync(home, { recursive: true })
  const file = autoscanFile()
  const tmp = `${file}.tmp`
  const normalised: AutoscanConfig = {
    enabled: Boolean(config.enabled),
    whitelist: Array.isArray(config.whitelist)
      ? [...new Set(config.whitelist.map((p) => String(p).trim()).filter(Boolean))]
      : [],
    intervalMs: config.intervalMs ?? DEFAULT_AUTOSCAN_CONFIG.intervalMs,
  }
  fs.writeFileSync(tmp, JSON.stringify(normalised, null, 2), 'utf8')
  fs.renameSync(tmp, file)
  return normalised
}
