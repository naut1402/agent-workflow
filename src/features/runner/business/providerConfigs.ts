import { joinPath, mkdirSync, readTextFileSync, writeTextFileAtomicSync } from '../../../core/lib/fileHelper.js'
import { registryHome } from '../../../core/registry.js'
import {
  PROVIDER_CONFIGS_VERSION,
  sanitiseProviderConfigId,
  type MutationResult,
  type ProviderConfig,
  type ProviderConfigsStore,
} from './types.js'

function providerConfigsFile(): string {
  return joinPath(registryHome(), 'provider-configs.json')
}

function emptyStore(): ProviderConfigsStore {
  return { version: PROVIDER_CONFIGS_VERSION, providerConfigs: [] }
}

function normaliseProviderConfig(raw: any): ProviderConfig | null {
  const id = sanitiseProviderConfigId(raw?.id)
  if (!id) return null
  const providerId = String(raw.providerId || '').trim()
  if (!providerId) return null
  return {
    id,
    label: String(raw.label || id).slice(0, 128),
    providerId,
    baseURL: raw.baseURL != null ? String(raw.baseURL) : undefined,
  }
}

export function loadProviderConfigs(): ProviderConfigsStore {
  const file = providerConfigsFile()
  let raw: string
  try {
    raw = readTextFileSync(file)
  } catch {
    return emptyStore()
  }
  try {
    const data = JSON.parse(raw)
    if (!data || !Array.isArray(data.providerConfigs)) return emptyStore()
    return {
      version: data.version || PROVIDER_CONFIGS_VERSION,
      providerConfigs: data.providerConfigs.map(normaliseProviderConfig).filter(Boolean) as ProviderConfig[],
    }
  } catch {
    console.warn(`[dev-team-dashboard] provider-configs.json corrupt: ${file}`)
    return emptyStore()
  }
}

export function saveProviderConfigs(store: ProviderConfigsStore): ProviderConfigsStore {
  const home = registryHome()
  mkdirSync(home, { recursive: true })
  writeTextFileAtomicSync(providerConfigsFile(), JSON.stringify(
    { version: store.version || PROVIDER_CONFIGS_VERSION, providerConfigs: store.providerConfigs || [] },
    null,
    2,
  ))
  return store
}

export function listProviderConfigs(): ProviderConfig[] {
  return loadProviderConfigs().providerConfigs
}

export function getProviderConfig(id: unknown): ProviderConfig | null {
  const clean = sanitiseProviderConfigId(id)
  if (!clean) return null
  return loadProviderConfigs().providerConfigs.find((c) => c.id === clean) || null
}

export function upsertProviderConfig(input: any): MutationResult<{ providerConfig: ProviderConfig }> {
  const id = sanitiseProviderConfigId(input?.id)
  if (!id) return { ok: false, error: 'invalid provider config id' }
  const providerId = String(input.providerId || '').trim()
  if (!providerId) return { ok: false, error: 'providerId is required' }

  const entry: ProviderConfig = {
    id,
    label: String(input.label || id).slice(0, 128),
    providerId,
    baseURL: input.baseURL != null ? String(input.baseURL) : undefined,
  }

  const store = loadProviderConfigs()
  const idx = store.providerConfigs.findIndex((c) => c.id === id)
  if (idx >= 0) store.providerConfigs[idx] = entry
  else store.providerConfigs.push(entry)
  saveProviderConfigs(store)
  return { ok: true, providerConfig: entry }
}

export function deleteProviderConfig(id: unknown): MutationResult {
  const clean = sanitiseProviderConfigId(id)
  if (!clean) return { ok: false, status: 400, error: 'invalid id' }
  const store = loadProviderConfigs()
  const idx = store.providerConfigs.findIndex((c) => c.id === clean)
  if (idx < 0) return { ok: false, status: 404, error: 'not found' }
  store.providerConfigs.splice(idx, 1)
  saveProviderConfigs(store)
  return { ok: true }
}
