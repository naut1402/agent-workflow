/** Priority of a catalog source when deduping items with the same name. */
export function sourcePriority(source: string): number {
  if (source === 'dashboard') return 55
  if (source === 'project') return 50
  if (source === 'user') return 20
  if (source === 'cursor') return 10
  if (typeof source === 'string' && source.startsWith('repo:')) return 40
  if (typeof source === 'string' && source.startsWith('plugin:')) return 45
  return 0
}

/**
 * Dedupe catalog items by `name`, keeping the highest-priority source, then
 * sort by name. Pure — the core of catalog source precedence.
 */
export function dedupeCatalogItems<T extends { name: string; source: string }>(items: T[]): T[] {
  const byName = new Map<string, T>()
  for (const item of items) {
    const existing = byName.get(item.name)
    if (!existing || sourcePriority(item.source) > sourcePriority(existing.source)) {
      byName.set(item.name, item)
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}
