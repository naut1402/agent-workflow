import fs from 'node:fs'
import path from 'node:path'
import { registryHome } from '../registry.js'
import {
  RUNNERS_VERSION,
  sanitiseRunnerId,
  type RunnerConfig,
  type RunnersStore,
  type MutationResult,
} from './types.js'
import { getProvider } from './providerRegistry.js'

function runnersFile(): string {
  return path.join(registryHome(), 'runners.json')
}

export const BUILTIN_SERVER_RUNNER: RunnerConfig = {
  id: 'claude-code-server',
  name: 'Claude Code CLI (server headless)',
  provider: 'claude-code-cli',
  credentialId: 'claude-server-env',
  enabled: true,
  maxConcurrency: 1,
  config: {
    cliPath: 'claude',
    flags: ['--bare'],
    timeoutMs: 600_000,
    allowedTools: 'Read,Write,Bash,Grep,Glob',
  },
}

function defaultRunners(): RunnersStore {
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
      { ...BUILTIN_SERVER_RUNNER },
    ],
  }
}

function ensureBuiltinRunners(store: RunnersStore): RunnersStore {
  const builtins = [BUILTIN_SERVER_RUNNER]
  let changed = false
  for (const b of builtins) {
    if (!store.runners.some((r) => r.id === b.id)) {
      store.runners.push({ ...b })
      changed = true
    }
  }
  if (changed) saveRunners(store)
  return store
}

export function loadRunners(): RunnersStore {
  const file = runnersFile()
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return ensureBuiltinRunners(defaultRunners())
  }
  try {
    const data = JSON.parse(raw)
    if (!data || !Array.isArray(data.runners)) return ensureBuiltinRunners(defaultRunners())
    const store: RunnersStore = {
      version: data.version || RUNNERS_VERSION,
      defaultRunnerId: data.defaultRunnerId || data.runners[0]?.id || 'claude-code-local',
      runners: data.runners,
    }
    return ensureBuiltinRunners(store)
  } catch {
    console.warn(`[dev-team-dashboard] runners.json corrupt: ${file}`)
    return ensureBuiltinRunners(defaultRunners())
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
  if (!runner.provider) return { ok: false, error: 'provider is required' }
  if (!runner.credentialId) return { ok: false, error: 'credentialId is required' }

  const store = loadRunners()
  const idx = store.runners.findIndex((r) => r.id === id)
  const mergedConfig = {
    ...(idx >= 0 ? store.runners[idx].config : {}),
    ...(runner.config && typeof runner.config === 'object' ? runner.config : {}),
  }

  const entry: RunnerConfig = {
    id,
    name: String(runner.name || id).slice(0, 128),
    provider: runner.provider,
    credentialId: sanitiseCredentialId(runner.credentialId) || runner.credentialId,
    enabled: runner.enabled !== false,
    maxConcurrency: Number(runner.maxConcurrency) > 0 ? Number(runner.maxConcurrency) : 1,
    config: mergedConfig,
  }

  const provider = getProvider(entry.provider)
  if (provider) {
    const validateConfig = { ...entry.config }
    if (entry.provider === 'claude-code-cli' && !validateConfig.cliPath) {
      validateConfig.cliPath = 'claude'
    }
    const validation = provider.validateRunnerConfig(validateConfig)
    if (!validation.ok) {
      return { ok: false, error: validation.errors.join('; ') }
    }
  }
  if (idx >= 0) store.runners[idx] = { ...store.runners[idx], ...entry }
  else store.runners.push(entry)

  if (!store.defaultRunnerId || !store.runners.some((r) => r.id === store.defaultRunnerId)) {
    store.defaultRunnerId = id
  }
  saveRunners(store)
  return { ok: true, runner: entry }
}

function sanitiseCredentialId(id: unknown): string | null {
  if (typeof id !== 'string' || !id.trim()) return null
  return id.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || null
}

export function deleteRunner(id: unknown): MutationResult {
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
