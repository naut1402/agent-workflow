import fs from 'node:fs'
import path from 'node:path'
import { registryHome } from '../registry.js'
import { RUNNERS_VERSION, sanitiseRunnerId } from './types.js'

function runnersFile() {
  return path.join(registryHome(), 'runners.json')
}

function defaultRunners() {
  return {
    version: RUNNERS_VERSION,
    defaultRunnerId: 'claude-code-local',
    runners: [
      {
        id: 'claude-code-local',
        name: 'Claude Code CLI (local)',
        provider: 'claude-code-cli',
        credentialId: 'claude-default',
        enabled: true,
        maxConcurrency: 1,
        config: {
          cliPath: 'claude',
          flags: [],
          timeoutMs: 600_000,
          allowedTools: 'Read,Write,Bash,Grep,Glob',
        },
      },
    ],
  }
}

export function loadRunners() {
  const file = runnersFile()
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return defaultRunners()
  }
  try {
    const data = JSON.parse(raw)
    if (!data || !Array.isArray(data.runners)) return defaultRunners()
    return {
      version: data.version || RUNNERS_VERSION,
      defaultRunnerId: data.defaultRunnerId || data.runners[0]?.id || 'claude-code-local',
      runners: data.runners,
    }
  } catch {
    console.warn(`[dev-team-dashboard] runners.json corrupt: ${file}`)
    return defaultRunners()
  }
}

export function saveRunners(store) {
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

export function listRunners() {
  const store = loadRunners()
  return { defaultRunnerId: store.defaultRunnerId, runners: store.runners }
}

export function getRunner(id) {
  const clean = sanitiseRunnerId(id)
  if (!clean) return null
  return loadRunners().runners.find((r) => r.id === clean) || null
}

export function getDefaultRunner() {
  const store = loadRunners()
  const hit =
    store.runners.find((r) => r.id === store.defaultRunnerId && r.enabled !== false) ||
    store.runners.find((r) => r.enabled !== false)
  return hit || null
}

export function upsertRunner(runner) {
  const id = sanitiseRunnerId(runner?.id)
  if (!id) return { ok: false, error: 'invalid runner id' }
  if (!runner.provider) return { ok: false, error: 'provider is required' }
  if (!runner.credentialId) return { ok: false, error: 'credentialId is required' }

  const store = loadRunners()
  const entry = {
    id,
    name: String(runner.name || id).slice(0, 128),
    provider: runner.provider,
    credentialId: sanitiseCredentialId(runner.credentialId) || runner.credentialId,
    enabled: runner.enabled !== false,
    maxConcurrency: Number(runner.maxConcurrency) > 0 ? Number(runner.maxConcurrency) : 1,
    config: runner.config && typeof runner.config === 'object' ? runner.config : {},
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

function sanitiseCredentialId(id) {
  if (typeof id !== 'string' || !id.trim()) return null
  return id.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || null
}

export function deleteRunner(id) {
  const clean = sanitiseRunnerId(id)
  if (!clean) return { ok: false, status: 400, error: 'invalid id' }
  const store = loadRunners()
  if (store.runners.length <= 1) {
    return { ok: false, status: 400, error: 'cannot delete last runner' }
  }
  const idx = store.runners.findIndex((r) => r.id === clean)
  if (idx < 0) return { ok: false, status: 404, error: 'not found' }
  store.runners.splice(idx, 1)
  if (store.defaultRunnerId === clean) {
    store.defaultRunnerId = store.runners[0]?.id || null
  }
  saveRunners(store)
  return { ok: true }
}

export function setDefaultRunner(id) {
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

export function substituteConfig(config, vars) {
  const out = {}
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
