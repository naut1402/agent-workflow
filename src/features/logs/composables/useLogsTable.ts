import { computed, ref, type Ref } from 'vue'
import { LOG_LEVELS, type LogEntry, type LogLevel } from '../../../core/log/schema'

export type SortDir = 'asc' | 'desc'

/** One column in a (possibly multi-column) sort. */
export type SortSpec = { key: string; dir: SortDir }

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

/** UI header keys `time` / `iso` map to the same sort key as `ts`. */
export function canonicalSortKey(key: string): string {
  if (key === 'time' || key === 'iso') return 'ts'
  return key
}

function defaultDir(key: string): SortDir {
  return canonicalSortKey(key) === 'ts' ? 'desc' : 'asc'
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
    if (key === 'query') return entry.query || ''
    if (key === 'response') return entry.response || ''
    if (key === 'status') return entry.status
    if (key === 'ms' || key === 'durationMs') return entry.durationMs
  } else if (entry.type === 'events') {
    if (key === 'event') return entry.event
    if (key === 'payload') {
      try {
        return JSON.stringify(entry.payload ?? {})
      } catch {
        return ''
      }
    }
  } else if (entry.type === 'audit') {
    if (key === 'op') return entry.op
    if (key === 'entity') return entry.entity
    if (key === 'identifier') return entry.identifier || ''
  } else if (entry.type === 'usage') {
    if (key === 'jobId') return entry.jobId
    if (key === 'taskId') return entry.taskId || ''
    if (key === 'sessionId') return entry.sessionId || ''
    if (key === 'model') return entry.model || ''
    if (key === 'provider') return entry.provider
    if (key === 'inputTokens') return entry.inputTokens
    if (key === 'outputTokens') return entry.outputTokens
    if (key === 'cacheReadTokens') return entry.cacheReadTokens ?? 0
    if (key === 'cacheWriteTokens') return entry.cacheWriteTokens ?? 0
    if (key === 'totalTokens') return entry.totalTokens
  }
  return ''
}

function compareCells(a: LogEntry, b: LogEntry, key: string, dir: SortDir): number {
  const sign = dir === 'asc' ? 1 : -1
  const va = cellValue(a, key)
  const vb = cellValue(b, key)
  if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sign
  return String(va).localeCompare(String(vb), undefined, { numeric: true }) * sign
}

function matchesQuery(entry: LogEntry, q: string): boolean {
  if (!q) return true
  const hay = [
    entry.level,
    entry.traceId,
    entry.projectId,
    entry.iso,
    entry.type === 'request'
      ? [
          entry.method,
          entry.path,
          entry.query,
          entry.response,
          String(entry.status),
          String(entry.durationMs),
          entry.error,
        ]
      : entry.type === 'events'
        ? [entry.event, JSON.stringify(entry.payload ?? {})]
        : entry.type === 'audit'
          ? [entry.op, entry.entity, entry.identifier]
          : entry.type === 'usage'
            ? [
                entry.jobId,
                entry.taskId,
                entry.model,
                entry.provider,
                entry.sessionId,
                String(entry.inputTokens),
                String(entry.outputTokens),
                String(entry.cacheReadTokens ?? 0),
                String(entry.cacheWriteTokens ?? 0),
                String(entry.totalTokens),
              ]
            : [],
  ]
    .flat()
    .filter((x) => x != null && x !== '')
    .join(' ')
    .toLowerCase()
  return hay.includes(q)
}

/** Client-side filter + column sort for audit/request tables (limit ~200). */
export function useLogsTable(entries: Ref<LogEntry[]>) {
  /** Ordered sort keys: primary first. Shift+click appends; plain click replaces. */
  const sortSpecs = ref<SortSpec[]>([{ key: 'ts', dir: 'desc' }])
  const filters = ref<LogsTableFilters>({
    levels: [],
    traceId: '',
    q: '',
  })

  /**
   * @param append — true when Shift is held: add/toggle column in multi-sort stack.
   *                 false: replace stack with this column only (toggle dir if same).
   */
  function toggleSort(key: string, opts?: { append?: boolean }) {
    const canon = canonicalSortKey(key)
    const append = opts?.append === true
    const specs = sortSpecs.value
    const idx = specs.findIndex((s) => canonicalSortKey(s.key) === canon)

    if (!append) {
      if (idx === 0 && specs.length === 1) {
        sortSpecs.value = [{ key: canon, dir: specs[0].dir === 'asc' ? 'desc' : 'asc' }]
        return
      }
      sortSpecs.value = [{ key: canon, dir: defaultDir(canon) }]
      return
    }

    if (idx >= 0) {
      const next = specs.slice()
      next[idx] = { key: canon, dir: next[idx].dir === 'asc' ? 'desc' : 'asc' }
      sortSpecs.value = next
      return
    }
    sortSpecs.value = [...specs, { key: canon, dir: defaultDir(canon) }]
  }

  /** Arrow + optional priority index when multi-sorting (e.g. `↑1`). */
  function sortIndicator(key: string): string {
    const canon = canonicalSortKey(key)
    const idx = sortSpecs.value.findIndex((s) => canonicalSortKey(s.key) === canon)
    if (idx < 0) return ''
    const arrow = sortSpecs.value[idx].dir === 'asc' ? '↑' : '↓'
    if (sortSpecs.value.length <= 1) return arrow
    return `${arrow}${idx + 1}`
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
    const specs = sortSpecs.value
    rows = rows.slice().sort((a, b) => {
      for (const spec of specs) {
        const cmp = compareCells(a, b, canonicalSortKey(spec.key), spec.dir)
        if (cmp !== 0) return cmp
      }
      return 0
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
    sortSpecs,
    filters,
    displayed,
    toggleSort,
    sortIndicator,
    setLevelFilter,
    clearFilters,
    LOG_LEVELS,
  }
}
