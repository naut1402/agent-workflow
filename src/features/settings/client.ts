import { qs } from '../../api/http'

// ── Project registry ───────────────────────────────────────────────────────────

export async function fetchProjects() {
  const r = await fetch('/api/projects')
  if (!r.ok) throw new Error(`/api/projects → ${r.status}`)
  return r.json()
}

export async function fetchProject(id: string) {
  const r = await fetch(`/api/projects${qs({ id })}`)
  if (!r.ok) throw new Error(`/api/projects?id=${id} → ${r.status}`)
  return r.json()
}

export async function addProject(path: string, name?: string) {
  const r = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, name }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/projects POST → ${r.status}`)
  return data
}

export async function removeProject(id: string) {
  const r = await fetch(`/api/projects${qs({ id })}`, { method: 'DELETE' })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/projects DELETE → ${r.status}`)
  return data
}

// ── Filesystem browse + autoscan ─────────────────────────────────────────────

export async function browseFs(dirPath?: string) {
  const r = await fetch(`/api/fs/browse${qs({ path: dirPath ?? '' })}`)
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/fs/browse → ${r.status}`)
  return data
}

export async function fetchAutoscanConfig() {
  const r = await fetch('/api/autoscan')
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/autoscan → ${r.status}`)
  return data
}

export async function saveAutoscanConfig(config: {
  enabled?: boolean
  whitelist?: string[]
  intervalMs?: number
}) {
  const r = await fetch('/api/autoscan', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/autoscan PUT → ${r.status}`)
  return data
}

export async function runAutoscan(whitelist?: string[]) {
  const r = await fetch('/api/autoscan/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(whitelist ? { whitelist } : {}),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/autoscan/run → ${r.status}`)
  return data
}

export async function fetchGithubTokensConfig() {
  const r = await fetch('/api/github/tokens')
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/github/tokens → ${r.status}`)
  return data
}

export async function saveGithubTokensConfig(config: {
  repos?: { repo: string; token: string }[]
}) {
  const r = await fetch('/api/github/tokens', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/github/tokens PUT → ${r.status}`)
  return data
}
