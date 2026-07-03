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
    raw = fs.readFileSync(file, 'utf8')
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

/** Warn if SSH private key file permissions are too open (does not block). */
export function validateSshKeyFile(keyPath: string): { ok: boolean; warn?: string } {
  try {
    if (!fs.existsSync(keyPath)) {
      return { ok: false, warn: `SSH key not found: ${keyPath}` }
    }
    if (process.platform === 'win32') {
      return { ok: true }
    }
    const mode = fs.statSync(keyPath).mode & 0o777
    if (mode > 0o600) {
      const msg = `SSH key ${keyPath} has mode ${mode.toString(8)} (recommended 600)`
      console.warn(`[dev-team-dashboard] ${msg}`)
      return { ok: true, warn: msg }
    }
    return { ok: true }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, warn: message }
  }
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
