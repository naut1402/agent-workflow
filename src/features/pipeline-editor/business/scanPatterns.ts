import { joinPath, resolvePathUnder, safeReadDir } from '../../../backend/lib/fileHelper.js'

export const SCAN_PATTERN_MAX_DEPTH = 8
export const SCAN_PATTERN_MAX_MATCHES = 200
export const SCAN_PATTERN_MAX_DIRS = 4000

export const DENY_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.output', '.cache'])

export interface PatternMatch {
  path: string
  isDirectory: boolean
}

interface Budget {
  dirs: number
  matches: number
}

function segmentToRegExp(seg: string): RegExp {
  const body = seg
    // xem docs/architecture/code/pipeline-editor.md §10
    .replace(/\*{2,}/g, '*')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
  return new RegExp(`^${body}$`)
}

function segmentMatches(seg: string, name: string): boolean {
  if (name.startsWith('.') && !seg.startsWith('.')) return false
  return segmentToRegExp(seg).test(name)
}

function push(
  projectRoot: string,
  full: string,
  isDirectory: boolean,
  seen: Map<string, PatternMatch>,
  budget: Budget,
): void {
  if (budget.matches >= SCAN_PATTERN_MAX_MATCHES) return
  if (!resolvePathUnder(projectRoot, full)) return
  if (seen.has(full)) return
  seen.set(full, { path: full, isDirectory })
  budget.matches++
}

interface WalkCursor {
  projectRoot: string
  segs: string[]
  seen: Map<string, PatternMatch>
  budget: Budget
}

type DirEntries = Awaited<ReturnType<typeof safeReadDir>>

async function walkDoubleStar(
  cursor: WalkCursor,
  dir: string,
  entries: DirEntries,
  i: number,
  depth: number,
): Promise<void> {
  await walk(cursor, dir, i + 1, depth)
  for (const entry of entries) {
    // xem docs/architecture/code/pipeline-editor.md §10
    if (entry.isSymbolicLink()) continue
    if (!entry.isDirectory() || DENY_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
    await walk(cursor, joinPath(dir, entry.name), i, depth + 1)
  }
}

async function walkSegment(
  cursor: WalkCursor,
  entries: DirEntries,
  dir: string,
  i: number,
  depth: number,
): Promise<void> {
  const seg = cursor.segs[i]
  const last = i === cursor.segs.length - 1
  for (const entry of entries) {
    // xem docs/architecture/code/pipeline-editor.md §10
    if (entry.isSymbolicLink()) continue
    if (DENY_DIRS.has(entry.name) || !segmentMatches(seg, entry.name)) continue
    const full = joinPath(dir, entry.name)
    if (last) push(cursor.projectRoot, full, entry.isDirectory(), cursor.seen, cursor.budget)
    else if (entry.isDirectory()) await walk(cursor, full, i + 1, depth + 1)
  }
}

async function walk(cursor: WalkCursor, dir: string, i: number, depth: number): Promise<void> {
  const { budget, segs } = cursor
  if (budget.matches >= SCAN_PATTERN_MAX_MATCHES || depth > SCAN_PATTERN_MAX_DEPTH) return

  if (i >= segs.length) {
    push(cursor.projectRoot, dir, true, cursor.seen, budget)
    return
  }

  if (budget.dirs >= SCAN_PATTERN_MAX_DIRS) return
  budget.dirs++
  const entries = await safeReadDir(dir)

  if (segs[i] === '**') await walkDoubleStar(cursor, dir, entries, i, depth)
  else await walkSegment(cursor, entries, dir, i, depth)
}

/**
 * Expand every pattern of one kind (`settings.scanPatterns`) into concrete paths
 * under `projectRoot`, sharing a single budget. A pattern is a relative path whose
 * segments may use `*`, `?` (single segment) and `**` (any number of segments).
 * Hitting a budget stops the walk and returns what was found instead of throwing.
 */
export async function expandScanPatterns(
  projectRoot: string,
  patterns: string[] | null | undefined,
): Promise<PatternMatch[]> {
  if (!projectRoot || !patterns?.length) return []
  const seen = new Map<string, PatternMatch>()
  const budget: Budget = { dirs: 0, matches: 0 }
  for (const raw of patterns) {
    const segs = String(raw)
      .replace(/\\/g, '/')
      .split('/')
      .filter((s) => s && s !== '.')
    // xem docs/architecture/code/pipeline-editor.md §10
    if (!segs.length || segs.includes('..')) continue
    await walk({ projectRoot, segs, seen, budget }, projectRoot, 0, 0)
  }
  return [...seen.values()]
}
