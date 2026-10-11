import { joinPath, mkdirSync, readTextFileSync, writeTextFileAtomicSync } from '../../../backend/lib/fileHelper.js'
import { registryHome } from '../../../backend/registry.js'
import { ensureLegacyConnection, getConnection } from './connections.js'
import { getProvider, providerFamilyOf } from './providers/providerRegistry.js'
import {
  DEFAULT_CONNECTION_ID,
  RUNNERS_VERSION,
  sanitiseConnectionId,
  sanitiseRunnerId,
  type DefaultRunnerReason,
  type DefaultRunnerResolution,
  type RunnerConfig,
  type RunnersStore,
  type MutationResult,
} from './types.js'

export {
  cleanupOrphanedMcpDeliveries,
  getProvider,
  listProviderCatalog,
  listProviderIds,
  providerFamilyOf,
  registerProvider,
} from './providers/providerRegistry.js'

function runnersFile(): string {
  return joinPath(registryHome(), 'runners.json')
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
    raw = readTextFileSync(file)
  } catch {
    return emptyRunners()
  }
  try {
    // xem docs/architecture/code/runner.md §13
    const data = JSON.parse(raw.replace(/^\uFEFF/, ''))
    if (!data || !Array.isArray(data.runners)) return emptyRunners()
    const runners = data.runners.map(normalizeRunner).filter(Boolean) as RunnerConfig[]
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
  mkdirSync(home, { recursive: true })
  writeTextFileAtomicSync(runnersFile(), JSON.stringify(
    {
      version: store.version || RUNNERS_VERSION,
      defaultRunnerId: store.defaultRunnerId,
      runners: store.runners || [],
    },
    null,
    2,
  ))
  return store
}

export function listRunners(): {
  defaultRunnerId: string | null
  effectiveDefaultRunnerId: string | null
  defaultRunnerIssue: { runnerId: string | null; reason: DefaultRunnerReason } | null
  runners: RunnerConfig[]
} {
  const store = loadRunners()
  const d = resolveDefaultRunner(store)
  return {
    defaultRunnerId: store.defaultRunnerId,
    effectiveDefaultRunnerId: d.runner?.id ?? null,
    defaultRunnerIssue: d.reason === 'ok' ? null : { runnerId: d.runnerId, reason: d.reason },
    runners: store.runners,
  }
}

export function getRunner(id: unknown): RunnerConfig | null {
  const clean = sanitiseRunnerId(id)
  if (!clean) return null
  return loadRunners().runners.find((r) => r.id === clean) || null
}

function defaultRunnerIssueOf(r: RunnerConfig): 'disabled' | 'no-connection' | 'not-ai' | null {
  if (r.enabled === false) return 'disabled'
  const conn = getConnection(r.connectionId)
  if (!conn?.providerId) return 'no-connection'
  const family = providerFamilyOf(conn.providerId)
  return family === 'agent-cli' || family === 'ai-api' ? null : 'not-ai'
}

// xem docs/architecture/code/runner.md §2
/** Giải runner chạy khi job không pin — chỉ xét runner đã ghi nhận làm mặc định, không rơi sang runner khác. */
export function resolveDefaultRunner(store: RunnersStore = loadRunners()): DefaultRunnerResolution {
  if (!store.runners.length) return { runner: null, runnerId: null, reason: 'no-runners' }
  const id = store.defaultRunnerId
  if (!id) return { runner: null, runnerId: null, reason: 'unset' }
  const r = store.runners.find((x) => x.id === id)
  if (!r) return { runner: null, runnerId: id, reason: 'missing' }
  const issue = defaultRunnerIssueOf(r)
  return issue
    ? { runner: null, runnerId: id, reason: issue }
    : { runner: r, runnerId: id, reason: 'ok' }
}

let lastDefaultWarn = ''

/** Đưa throttle log runner mặc định về trạng thái ban đầu — chỉ dùng cho test. */
export function resetDefaultRunnerWarn(): void {
  lastDefaultWarn = ''
}

export function getDefaultRunner(): RunnerConfig | null {
  const res = resolveDefaultRunner()
  if (res.reason !== 'ok') {
    const key = `${res.runnerId ?? '-'}:${res.reason}`
    if (key !== lastDefaultWarn) {
      lastDefaultWarn = key
      console.warn(
        `[runner] không có runner mặc định dùng được (${res.runnerId ?? 'chưa đặt'}: ${res.reason})`,
      )
    }
  } else {
    lastDefaultWarn = ''
  }
  return res.runner
}

/** Agent CLI / AI API only — never console-command or unknown/missing provider. */
export function isEligibleDefaultAiRunner(r: RunnerConfig): boolean {
  return defaultRunnerIssueOf(r) === null
}

export function upsertRunner(runner: any): MutationResult<{ runner: RunnerConfig }> {
  const id = sanitiseRunnerId(runner?.id)
  if (!id) return { ok: false, error: 'invalid runner id' }

  // xem docs/architecture/code/runner.md §1
  if (runner?.create === true && loadRunners().runners.some((r) => r.id === id)) {
    return { ok: false, status: 409, error: `runner id "${id}" đã tồn tại` }
  }

  let connectionId = sanitiseConnectionId(runner.connectionId)
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
    store.defaultRunnerId = store.runners.find((r) => isEligibleDefaultAiRunner(r))?.id || null
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
    store.defaultRunnerId = store.runners.find((r) => isEligibleDefaultAiRunner(r))?.id || null
  }
  saveRunners(store)
  return { ok: true }
}

export function setDefaultRunner(id: unknown): MutationResult<{ defaultRunnerId: string }> {
  const clean = sanitiseRunnerId(id)
  if (!clean) return { ok: false, status: 400, error: 'invalid id' }
  const store = loadRunners()
  const runner = store.runners.find((r) => r.id === clean)
  if (!runner) {
    return { ok: false, status: 404, error: 'runner not found' }
  }
  const conn = getConnection(runner.connectionId)
  // xem docs/architecture/code/runner.md §13
  if (conn && getProvider(conn.providerId)?.acceptsAgent === false) {
    return {
      ok: false,
      status: 400,
      error: 'console-command cannot be the default AI runner; pick an Agent CLI connection',
    }
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

/** Kết quả giải pin runner của step — chỉ dùng cho log. */
export type StepRunnerReason = 'unpinned' | 'pinned' | 'missing' | 'disabled' | 'ineligible'

export type StepRunnerResolution = { runnerId: string | undefined; reason: StepRunnerReason }

/**
 * Giải `steps[].runner_id` thành runner id cho `submitJob`. Pin hỏng (runner đã xoá,
 * bị tắt, không phải runner AI) trả `undefined` để rơi về runner mặc định.
 */
export function resolveStepRunnerId(step: unknown): StepRunnerResolution {
  const raw = (step as { runner_id?: unknown } | null)?.runner_id
  if (typeof raw !== 'string' || !raw.trim()) return { runnerId: undefined, reason: 'unpinned' }

  // xem docs/architecture/code/runner.md §13
  if (sanitiseRunnerId(raw) !== raw) return warnStepRunner(step, raw, 'missing')

  const runner = getRunner(raw)
  if (!runner) return warnStepRunner(step, raw, 'missing')
  if (runner.enabled === false) return warnStepRunner(step, raw, 'disabled')
  if (!isEligibleDefaultAiRunner(runner)) return warnStepRunner(step, raw, 'ineligible')

  return { runnerId: runner.id, reason: 'pinned' }
}

function warnStepRunner(step: unknown, raw: string, reason: StepRunnerReason): StepRunnerResolution {
  const stepId = (step as { id?: unknown } | null)?.id
  console.warn(`[pipeline] step "${String(stepId)}" pinned runner "${raw}" ${reason} — dùng runner mặc định`)
  return { runnerId: undefined, reason }
}
