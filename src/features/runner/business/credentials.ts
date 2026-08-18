import crypto from 'node:crypto'
import { joinPath, mkdirSync, readTextFileSync, writeTextFileAtomicSync } from '../../../core/lib/fileHelper.js'
import { registryHome } from '../../../core/registry.js'
import { deleteSecret, readSecret, storeSecret } from './secretVault.js'
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
  /** Pasted directly through ConnectionDialog.vue, encrypted in secretVault.ts. */
  | { type: 'stored'; value: string | null }
  /** From the "Connect via browser" flow (oauthCredentials.ts), encrypted in secretVault.ts. */
  | { type: 'oauth'; value: string | null; expiresAt: string | null }
  | { type: 'unknown'; ref: string }

/** Secret kinds that resolve to a directly usable API key/token string (as opposed to `cli-session`, `none`, `unknown`). */
export function isDirectSecretType(type: ResolvedSecret['type']): boolean {
  return type === 'env' || type === 'stored' || type === 'oauth'
}

function credentialsFile(): string {
  return joinPath(registryHome(), 'credentials.json')
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
    ],
  }
}

export function loadCredentials(): CredentialsStore {
  const file = credentialsFile()
  let raw: string
  try {
    raw = readTextFileSync(file)
  } catch {
    return emptyStore()
  }
  try {
    const data = JSON.parse(raw)
    if (!data || !Array.isArray(data.profiles)) return emptyStore()
    return { version: data.version || CREDENTIALS_VERSION, profiles: data.profiles }
  } catch {
    console.warn(`[dev-team-dashboard] credentials.json corrupt: ${file}`)
    return emptyStore()
  }
}

export function saveCredentials(store: CredentialsStore): CredentialsStore {
  const home = registryHome()
  mkdirSync(home, { recursive: true })
  writeTextFileAtomicSync(credentialsFile(), JSON.stringify(
    { version: store.version || CREDENTIALS_VERSION, profiles: store.profiles || [] },
    null,
    2,
  ))
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

/**
 * `profile.id` is optional — the "+ Credential" form no longer asks the user
 * to type one (it's an internal key, not something they need to see/manage),
 * so a fresh id is minted when omitted.
 */
export function upsertCredential(profile: any): MutationResult<{ profile: CredentialProfile }> {
  const id = profile?.id ? sanitiseCredentialId(profile.id) : crypto.randomUUID()
  if (!id) return { ok: false, error: 'invalid credential id' }
  if (!profile.provider || typeof profile.provider !== 'string') {
    return { ok: false, error: 'provider is required' }
  }
  const store = loadCredentials()
  // `secretValue` is the real secret pasted through the UI (never persisted as-is) —
  // store it encrypted and point secretRef at the vault entry instead of at the raw value.
  let secretRef = String(profile.secretRef || 'cli-session').slice(0, 256)
  if (typeof profile.secretValue === 'string' && profile.secretValue.trim()) {
    storeSecret(id, { value: profile.secretValue })
    secretRef = `stored:${id}`
  }
  const entry: CredentialProfile = {
    id,
    provider: profile.provider,
    label: String(profile.label || id).slice(0, 128),
    secretRef,
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
  const [removed] = store.profiles.splice(idx, 1)
  if (!store.profiles.length) {
    return { ok: false, status: 400, error: 'cannot delete last credential profile' }
  }
  saveCredentials(store)
  if (removed?.secretRef?.startsWith('stored:') || removed?.secretRef?.startsWith('oauth:')) {
    deleteSecret(removed.secretRef.slice(removed.secretRef.indexOf(':') + 1))
  }
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
  if (ref.startsWith('stored:')) {
    const entry = readSecret<{ value?: string }>(ref.slice(7))
    return { type: 'stored', value: entry?.value ?? null }
  }
  if (ref.startsWith('oauth:')) {
    const entry = readSecret<{ accessToken?: string; expiresAt?: string }>(ref.slice(6))
    return { type: 'oauth', value: entry?.accessToken ?? null, expiresAt: entry?.expiresAt ?? null }
  }
  return { type: 'unknown', ref }
}
