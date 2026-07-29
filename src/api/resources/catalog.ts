// Read-only catalog (pipeline step catalog, per-agent catalog entry, rules).

export async function fetchCatalog() {
  const r = await fetch('/api/catalog')
  if (!r.ok) throw new Error(`/api/catalog → ${r.status}`)
  return r.json()
}

export async function fetchCatalogAgent(id: string) {
  const r = await fetch(`/api/catalog-agent?id=${encodeURIComponent(id)}`)
  if (!r.ok) throw new Error(`/api/catalog-agent → ${r.status}`)
  return r.json()
}

export async function fetchRules() {
  const r = await fetch('/api/rules')
  if (!r.ok) throw new Error(`/api/rules → ${r.status}`)
  return r.json()
}
