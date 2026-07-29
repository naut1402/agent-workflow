// Runner registry (connections/credentials) CRUD.

export async function fetchRunners() {
  const r = await fetch('/api/runners')
  if (!r.ok) throw new Error(`/api/runners → ${r.status}`)
  return r.json()
}

export async function saveRunner(runner: unknown) {
  const r = await fetch('/api/runners', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runner }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/runners POST → ${r.status}`)
  return data
}

export async function deleteRunner(id: string) {
  const r = await fetch(`/api/runners?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/runners DELETE → ${r.status}`)
  return data
}

export async function setDefaultRunner(id: string) {
  const r = await fetch('/api/runners/default', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/runners/default → ${r.status}`)
  return data
}

export async function fetchCredentials() {
  const r = await fetch('/api/credentials')
  if (!r.ok) throw new Error(`/api/credentials → ${r.status}`)
  return r.json()
}

export async function saveCredential(profile: unknown) {
  const r = await fetch('/api/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/credentials POST → ${r.status}`)
  return data
}

export async function fetchConnections() {
  const r = await fetch('/api/connections')
  if (!r.ok) throw new Error(`/api/connections → ${r.status}`)
  return r.json()
}

export async function saveConnection(connection: unknown) {
  const r = await fetch('/api/connections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connection }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/connections POST → ${r.status}`)
  return data
}

export async function deleteConnection(id: string) {
  const r = await fetch(`/api/connections?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/connections DELETE → ${r.status}`)
  return data
}

export async function scanLocalCommands() {
  const r = await fetch('/api/connections/scan')
  if (!r.ok) throw new Error(`/api/connections/scan → ${r.status}`)
  return r.json()
}
