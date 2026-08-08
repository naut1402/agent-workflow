import { computed, ref, type Ref } from 'vue'
import { LOG_LEVELS, type LogEntry, type LogLevel } from '../../../core/log/schema'

export type SortDir = 'asc' | 'desc'

export type LogsTableFilters = {
  /** Empty = all levels. */
  levels: LogLevel[]
  traceId: string
  /** Free-text match across common columns. */
  q: string
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

function cellValue(entry: LogEntry, key: string): string | number {
  if (key === 'time' || key === 'iso') return entry.iso || entry.ts
  if (key === 'ts') return entry.ts
  if (key === 'level') return LEVEL_RANK[entry.level] ?? 0
  if (key === 'traceId') return entry.traceId || ''
  if (key === 'project' || key === 'projectId') return entry.projectId || ''
  if (entry.type === 'request') {
    if (key === 'method') return entry.method
    if (key === 'path') return entry.path
    if (key === 'status') return entry.status
    if (key === 'ms' || key === 'durationMs') return entry.durationMs
  } else {
    if (key === 'op') return entry.op
    if (key === 'entity') return entry.entity
    if (key === 'identifier') return entry.identifier || ''
  }
  return ''
}

function matchesQuery(entry: LogEntry, q: string): boolean {
  if (!q) return true
  const hay = [
    entry.level,
    entry.traceId,
    entry.projectId,
    entry.iso,
    entry.type === 'request'
      ? [entry.method, entry.path, String(entry.status), String(entry.durationMs), entry.error]
      : [entry.op, entry.entity, entry.identifier],
  ]
    .flat()
    .filter((x) => x != null && x !== '')
    .join(' ')
    .toLowerCase()
  return hay.includes(q)
}

/** Client-side filter + column sort for audit/request tables (limit ~200). */
export function useLogsTable(entries: Ref<LogEntry[]>) {
  const sortKey = ref<string>('ts')
  const sortDir = ref<SortDir>('desc')
  const filters = ref<LogsTableFilters>({
    levels: [],
    traceId: '',
    q: '',
  })

  function toggleSort(key: string) {
    if (sortKey.value === key) {
      sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
      return
    }
    sortKey.value = key
    sortDir.value = key === 'ts' || key === 'time' || key === 'iso' ? 'desc' : 'asc'
  }

  function sortIndicator(key: string): '' | '↑' | '↓' {
    const active =
      sortKey.value === key ||
      (key === 'time' && (sortKey.value === 'ts' || sortKey.value === 'iso'))
    if (!active) return ''
    return sortDir.value === 'asc' ? '↑' : '↓'
  }

  const displayed = computed(() => {
    const q = filters.value.q.trim().toLowerCase()
    const trace = filters.value.traceId.trim().toLowerCase()
    const levels = filters.value.levels
    let rows = entries.value.filter((e) => {
      if (levels.length && !levels.includes(e.level)) return false
      if (trace && !(e.traceId || '').toLowerCase().includes(trace)) return false
      if (!matchesQuery(e, q)) return false
      return true
    })
    const key = sortKey.value === 'time' ? 'iso' : sortKey.value
    const dir = sortDir.value === 'asc' ? 1 : -1
    rows = rows.slice().sort((a, b) => {
      const va = cellValue(a, key)
      const vb = cellValue(b, key)
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb), undefined, { numeric: true }) * dir
    })
    return rows
  })

  function setLevelFilter(level: LogLevel | 'all') {
    if (level === 'all') {
      filters.value = { ...filters.value, levels: [] }
      return
    }
    const cur = new Set(filters.value.levels)
    if (cur.has(level)) cur.delete(level)
    else cur.add(level)
    filters.value = { ...filters.value, levels: LOG_LEVELS.filter((l) => cur.has(l)) }
  }

  function clearFilters() {
    filters.value = { levels: [], traceId: '', q: '' }
  }

  return {
    sortKey,
    sortDir,
    filters,
    displayed,
    toggleSort,
    sortIndicator,
    setLevelFilter,
    clearFilters,
    LOG_LEVELS,
  }
}
