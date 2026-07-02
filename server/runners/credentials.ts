import fs from 'node:fs'
import path from 'node:path'
import { registryHome } from '../registry.js'
import {
  CREDENTIALS_VERSION,
  sanitiseCredentialId,
  type CredentialProfile,
  type CredentialsStore,
  type MutationResult,
} from './types.js'

export type ResolvedSecret =
  | { type: 'none' }
  | { type: 'cli-session' }
  | { type: 'env'; key: string; value: string | null }
  | { type: 'file'; path: string }
  | { type: 'unknown'; ref: string }

function credentialsFile(): string {
  return path.join(registryHome(), 'credentials.json')
}

export const BUILTIN_SERVER_CREDENTIAL: CredentialProfile = {
  id: 'claude-server-env',
  provider: 'claude-code-cli',
  label: 'Anthropic API Key (env)',
  secretRef: 'env:ANTHROPIC_API_KEY',
}

function emptyStore(): CredentialsStore {
  return {
    version: CREDENTIALS_VERSION,
    profiles: [
      {
        id: 'claude-default',
        provider: 'claude-code-cli',
        label: 'Claude Code (logged-in CLI)',
        secretRef: 'cli-session',
      },
      { ...BUILTIN_SERVER_CREDENTIAL },
    ],
  }
}

function ensureBuiltinCredentials(store: CredentialsStore): CredentialsStore {
  if (!store.profiles.some((p) => p.id === 'claude-server-env')) {
    store.profiles.push({ ...BUILTIN_SERVER_CREDENTIAL })
    saveCredentials(store)
  }
  return store
}

export function loadCredentials(): CredentialsStore {
  const file = credentialsFile()
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return ensureBuiltinCredentials(emptyStore())
  }
  try {
    const data = JSON.parse(raw)
    if (!data || !Array.isArray(data.profiles)) return ensureBuiltinCredentials(emptyStore())
    const store: CredentialsStore = {
      version: data.version || CREDENTIALS_VERSION,
      profiles: data.profiles,
    }
    return ensureBuiltinCredentials(store)
  } catch {
    console.warn(`[dev-team-dashboard] credentials.json corrupt: ${file}`)
    return ensureBuiltinCredentials(emptyStore())
  }
}

export function saveCredentials(store: CredentialsStore): CredentialsStore {
  const home = registryHome()
  fs.mkdirSync(home, { recursive: true })
  const file = credentialsFile()
  const tmp = `${file}.tmp`
  const payload = JSON.stringify(
    { version: store.version || CREDENTIALS_VERSION, profiles: store.profiles || [] },
    null,
    2,
  )
  fs.writeFileSync(tmp, payload, 'utf8')
  fs.renameSync(tmp, file)
  return store
}

export function listCredentials(): CredentialProfile[] {
  return loadCredentials().profiles
}

export function getCredential(id: unknown): CredentialProfile | null {
  const clean = sanitiseCredentialId(id)
  if (!clean) return null
  return loadCredentials().profiles.find((p) => p.id === clean) || null
}

export function upsertCredential(profile: any): MutationResult<{ profile: CredentialProfile }> {
  const id = sanitiseCredentialId(profile?.id)
  if (!id) return { ok: false, error: 'invalid credential id' }
  if (!profile.provider || typeof profile.provider !== 'string') {
    return { ok: false, error: 'provider is required' }
  }
  const store = loadCredentials()
  const entry: CredentialProfile = {
    id,
    provider: profile.provider,
    label: String(profile.label || id).slice(0, 128),
    secretRef: String(profile.secretRef || 'cli-session').slice(0, 256),
  }
  const idx = store.profiles.findIndex((p) => p.id === id)
  if (idx >= 0) store.profiles[idx] = entry
  else store.profiles.push(entry)
  saveCredentials(store)
  return { ok: true, profile: entry }
}

export function deleteCredential(id: unknown): MutationResult {
  const clean = sanitiseCredentialId(id)
  if (!clean) return { ok: false, status: 400, error: 'invalid id' }
  const store = loadCredentials()
  const idx = store.profiles.findIndex((p) => p.id === clean)
  if (idx < 0) return { ok: false, status: 404, error: 'not found' }
  store.profiles.splice(idx, 1)
  if (!store.profiles.length) {
    return { ok: false, status: 400, error: 'cannot delete last credential profile' }
  }
  saveCredentials(store)
  return { ok: true }
}

/** Resolve secretRef for provider runtime (never return raw secrets in API). */
export function resolveSecretRef(profile: CredentialProfile | undefined | null): ResolvedSecret {
  if (!profile?.secretRef) return { type: 'none' }
  const ref = profile.secretRef
  if (ref === 'cli-session') return { type: 'cli-session' }
  if (ref.startsWith('env:')) {
    const key = ref.slice(4)
    return { type: 'env', key, value: process.env[key] || null }
  }
  if (ref.startsWith('file:')) {
    return { type: 'file', path: ref.slice(5) }
  }
  return { type: 'unknown', ref }
}
