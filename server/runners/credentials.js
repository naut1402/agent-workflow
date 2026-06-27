import fs from 'node:fs'
import path from 'node:path'
import { registryHome } from '../registry.js'
import { CREDENTIALS_VERSION, sanitiseCredentialId } from './types.js'

function credentialsFile() {
  return path.join(registryHome(), 'credentials.json')
}

function emptyStore() {
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

export function loadCredentials() {
  const file = credentialsFile()
  let raw
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

export function saveCredentials(store) {
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

export function listCredentials() {
  return loadCredentials().profiles
}

export function getCredential(id) {
  const clean = sanitiseCredentialId(id)
  if (!clean) return null
  return loadCredentials().profiles.find((p) => p.id === clean) || null
}

export function upsertCredential(profile) {
  const id = sanitiseCredentialId(profile?.id)
  if (!id) return { ok: false, error: 'invalid credential id' }
  if (!profile.provider || typeof profile.provider !== 'string') {
    return { ok: false, error: 'provider is required' }
  }
  const store = loadCredentials()
  const entry = {
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

export function deleteCredential(id) {
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
export function resolveSecretRef(profile) {
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
