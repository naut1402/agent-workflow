import fs from 'node:fs'
import path from 'node:path'
import { registryHome } from '../registry.js'
import { ensureLegacyConnection } from './connections.js'
import {
  DEFAULT_CONNECTION_ID,
  RUNNERS_VERSION,
  sanitiseConnectionId,
  sanitiseRunnerId,
  type RunnerConfig,
  type RunnersStore,
  type MutationResult,
} from './types.js'

function runnersFile(): string {
  return path.join(registryHome(), 'runners.json')
}

function emptyRunners(): RunnersStore {
  return {
    version: RUNNERS_VERSION,
    defaultRunnerId: null,
    runners: [],
  }
}

function stripConnectionFieldsFromConfig(config: Record<string, unknown>): Record<string, unknown> {
  const out = { ...config }
  delete out.cliPath
  delete out.flags
  return out
}

/** Normalize raw runner JSON (v1 provider+credentialId or v2 connectionId). */
export function normalizeRunner(raw: any): RunnerConfig | null {
  const id = sanitiseRunnerId(raw?.id)
  if (!id) return null

  let connectionId = sanitiseConnectionId(raw.connectionId)
  const config =
    raw.config && typeof raw.config === 'object' ? ({ ...raw.config } as Record<string, unknown>) : {}

  if (!connectionId && raw.provider) {
    connectionId = ensureLegacyConnection({
      provider: raw.provider,
      credentialId: raw.credentialId,
      cliPath: typeof config.cliPath === 'string' ? config.cliPath : undefined,
      flags: config.flags,
    })
  }
  if (!connectionId) connectionId = DEFAULT_CONNECTION_ID

  return {
    id,
    name: String(raw.name || id).slice(0, 128),
    connectionId,
    enabled: raw.enabled !== false,
    maxConcurrency: Number(raw.maxConcurrency) > 0 ? Number(raw.maxConcurrency) : 1,
    config: stripConnectionFieldsFromConfig(config),
  }
}

export function loadRunners(): RunnersStore {
  const file = runnersFile()
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    // Chưa có file → danh sách trống (user tự tạo runner).
    return emptyRunners()
  }
  try {
    // Strip UTF-8 BOM (e.g. PowerShell Set-Content -Encoding utf8) so parse
    // does not fail and silently return an empty runner list.
    const data = JSON.parse(raw.replace(/^\uFEFF/, ''))
    if (!data || !Array.isArray(data.runners)) return emptyRunners()
    const runners = data.runners.map(normalizeRunner).filter(Boolean) as RunnerConfig[]
    // [] là trạng thái hợp lệ — không seed lại default.
    const defaultRunnerId =
      (data.defaultRunnerId && runners.some((r) => r.id === data.defaultRunnerId)
        ? data.defaultRunnerId
        : runners[0]?.id) || null
    return {
      version: RUNNERS_VERSION,
      defaultRunnerId,
      runners,
    }
  } catch {
    console.warn(`[dev-team-dashboard] runners.json corrupt: ${file}`)
    return emptyRunners()
  }
}

export function saveRunners(store: RunnersStore): RunnersStore {
  const home = registryHome()
  fs.mkdirSync(home, { recursive: true })
  const file = runnersFile()
  const tmp = `${file}.tmp`
  const payload = JSON.stringify(
    {
      version: store.version || RUNNERS_VERSION,
      defaultRunnerId: store.defaultRunnerId,
      runners: store.runners || [],
    },
    null,
    2,
  )
  fs.writeFileSync(tmp, payload, 'utf8')
  fs.renameSync(tmp, file)
  return store
}

export function listRunners(): { defaultRunnerId: string | null; runners: RunnerConfig[] } {
  const store = loadRunners()
  return { defaultRunnerId: store.defaultRunnerId, runners: store.runners }
}

export function getRunner(id: unknown): RunnerConfig | null {
  const clean = sanitiseRunnerId(id)
  if (!clean) return null
  return loadRunners().runners.find((r) => r.id === clean) || null
}

export function getDefaultRunner(): RunnerConfig | null {
  const store = loadRunners()
  const hit =
    store.runners.find((r) => r.id === store.defaultRunnerId && r.enabled !== false) ||
    store.runners.find((r) => r.enabled !== false)
  return hit || null
}

export function upsertRunner(runner: any): MutationResult<{ runner: RunnerConfig }> {
  const id = sanitiseRunnerId(runner?.id)
  if (!id) return { ok: false, error: 'invalid runner id' }

  let connectionId = sanitiseConnectionId(runner.connectionId)
  // Accept legacy payload during transition.
  if (!connectionId && runner.provider) {
    connectionId = ensureLegacyConnection({
      provider: runner.provider,
      credentialId: runner.credentialId,
      cliPath: runner.config?.cliPath,
      flags: runner.config?.flags,
    })
  }
  if (!connectionId) return { ok: false, error: 'connectionId is required' }

  const store = loadRunners()
  const entry: RunnerConfig = {
    id,
    name: String(runner.name || id).slice(0, 128),
    connectionId,
    enabled: runner.enabled !== false,
    maxConcurrency: Number(runner.maxConcurrency) > 0 ? Number(runner.maxConcurrency) : 1,
    config:
      runner.config && typeof runner.config === 'object'
        ? stripConnectionFieldsFromConfig({ ...runner.config })
        : {},
  }

  const idx = store.runners.findIndex((r) => r.id === id)
  if (idx >= 0) store.runners[idx] = { ...store.runners[idx], ...entry }
  else store.runners.push(entry)

  if (!store.defaultRunnerId || !store.runners.some((r) => r.id === store.defaultRunnerId)) {
    store.defaultRunnerId = id
  }
  saveRunners(store)
  return { ok: true, runner: entry }
}

export function deleteRunner(id: unknown): MutationResult {
  const clean = sanitiseRunnerId(id)
  if (!clean) return { ok: false, status: 400, error: 'invalid id' }
  const store = loadRunners()
  const idx = store.runners.findIndex((r) => r.id === clean)
  if (idx < 0) return { ok: false, status: 404, error: 'not found' }
  store.runners.splice(idx, 1)
  if (store.defaultRunnerId === clean) {
    store.defaultRunnerId = store.runners[0]?.id || null
  }
  saveRunners(store)
  return { ok: true }
}

export function setDefaultRunner(id: unknown): MutationResult<{ defaultRunnerId: string }> {
  const clean = sanitiseRunnerId(id)
  if (!clean) return { ok: false, status: 400, error: 'invalid id' }
  const store = loadRunners()
  if (!store.runners.some((r) => r.id === clean)) {
    return { ok: false, status: 404, error: 'runner not found' }
  }
  store.defaultRunnerId = clean
  saveRunners(store)
  return { ok: true, defaultRunnerId: clean }
}

export function substituteConfig(
  config: Record<string, unknown> | undefined,
  vars: { projectRoot?: string },
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(config || {})) {
    if (typeof v === 'string') {
      out[k] = v.replace(/\$\{projectRoot\}/g, vars.projectRoot || '')
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) =>
        typeof item === 'string' ? item.replace(/\$\{projectRoot\}/g, vars.projectRoot || '') : item,
      )
    } else {
      out[k] = v
    }
  }
  return out
}
