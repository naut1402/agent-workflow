import {
  basename,
  dirname,
  existsSync,
  relativePath,
  resolvePath,
  resolvePathUnder,
} from '../../../backend/lib/fileHelper.js'
import {
  formatGitFailure,
  runGit,
  GIT_READ_TIMEOUT_MS,
  GIT_WRITE_TIMEOUT_MS,
} from './git.js'

export interface WorktreeEntry {
  path: string
  /** Branch without the `refs/heads/` prefix; null when detached. */
  branch: string | null
  head: string | null
  detached: boolean
  bare: boolean
  locked: boolean
  lockReason: string | null
  prunable: boolean
  /** `git worktree list` always emits the main worktree first. */
  isMain: boolean
}

const WORKTREE_FIELDS: Record<string, (entry: WorktreeEntry, value: string) => void> = {
  worktree: (e, v) => {
    e.path = v
  },
  HEAD: (e, v) => {
    e.head = v || null
  },
  branch: (e, v) => {
    e.branch = v.replace(/^refs\/heads\//, '') || null
  },
  detached: (e) => {
    e.detached = true
  },
  bare: (e) => {
    e.bare = true
  },
  prunable: (e) => {
    e.prunable = true
  },
  locked: (e, v) => {
    e.locked = true
    e.lockReason = v || null
  },
}

function applyWorktreeField(entry: WorktreeEntry, line: string): void {
  const sp = line.indexOf(' ')
  const key = sp === -1 ? line : line.slice(0, sp)
  const value = sp === -1 ? '' : line.slice(sp + 1).trim()
  WORKTREE_FIELDS[key]?.(entry, value)
}

export function parseWorktreeList(stdout: string): WorktreeEntry[] {
  const blocks = String(stdout ?? '').split(/\r?\n\s*\r?\n/)
  const entries: WorktreeEntry[] = []
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    if (!lines.length) continue

    const entry: WorktreeEntry = {
      path: '',
      branch: null,
      head: null,
      detached: false,
      bare: false,
      locked: false,
      lockReason: null,
      prunable: false,
      isMain: entries.length === 0,
    }
    for (const line of lines) applyWorktreeField(entry, line)
    if (!entry.path) continue
    entries.push(entry)
  }
  return entries
}

export interface WorktreeMatch {
  entry: WorktreeEntry | null
  /** True when more than one candidate matched — refuse to guess, never remove. */
  ambiguous: boolean
  candidates: string[]
}

/**
 * Map a task to its worktree: exact directory name first, then task id inside
 * the branch name. `taskId` must already match `/[\w-]+/`.
 */
export function matchWorktreeForTask(entries: WorktreeEntry[], taskId: string): WorktreeMatch {
  const usable = entries.filter((e) => !e.isMain && !e.bare)

  const byName = usable.filter((e) => basename(e.path) === taskId)
  if (byName.length === 1) return { entry: byName[0], ambiguous: false, candidates: [] }
  if (byName.length > 1) {
    return { entry: null, ambiguous: true, candidates: byName.map((e) => e.path) }
  }

  const re = new RegExp(`(^|/)${taskId}([_/]|$)`)
  const byBranch = usable.filter((e) => e.branch && re.test(e.branch))
  if (byBranch.length === 1) return { entry: byBranch[0], ambiguous: false, candidates: [] }
  if (byBranch.length > 1) {
    return { entry: null, ambiguous: true, candidates: byBranch.map((e) => e.path) }
  }

  return { entry: null, ambiguous: false, candidates: [] }
}

/**
 * Accept only worktrees inside the repo or right next to it.
 * xem docs/architecture/code/monitor.md §16
 */
export function isRemovableWorktreePath(repoRoot: string, wtPath: string): boolean {
  if (!repoRoot || !wtPath) return false
  const base = resolvePath(repoRoot)
  const target = resolvePath(wtPath)

  if (target === base) return false
  if (resolvePathUnder(target, relativePath(target, base))) return false
  if (resolvePathUnder(base, relativePath(base, target))) return true
  return dirname(target) === dirname(base)
}

export interface WorktreeView {
  path: string
  /** Repo-relative path — short enough to show in a badge / confirm dialog. */
  relPath: string
  branch: string | null
  detached: boolean
  exists: boolean
  dirty: boolean
  dirtyCount: number
  locked: boolean
  lockReason: string | null
  removable: boolean
  blockedBy: 'dirty' | 'detached' | 'locked' | 'outside_policy' | null
}

export type FindWorktreeResult =
  | { ok: true; worktree: WorktreeView | null; ambiguous: boolean; candidates: string[] }
  | { ok: false; status: 500; error: 'git_failed'; detail: string }

type DirtyRead = { lines: string[] } | { error: string }

function readDirtyLines(wtPath: string): DirtyRead {
  // xem docs/architecture/code/monitor.md §16
  const res = runGit(['--no-optional-locks', '-C', wtPath, 'status', '--porcelain'], {
    timeout: GIT_READ_TIMEOUT_MS,
  })
  if (res.status !== 0) return { error: formatGitFailure(res, 'git status') }
  return { lines: String(res.stdout ?? '').split(/\r?\n/).filter(Boolean) }
}

/** Removability facts of a matched entry; a failed `git status` counts as dirty. */
export function buildWorktreeView(repoRoot: string, entry: WorktreeEntry): WorktreeView {
  const exists = existsSync(entry.path)
  const read: DirtyRead = exists ? readDirtyLines(entry.path) : { lines: [] }
  const lines = 'error' in read ? [] : read.lines
  const dirty = exists && ('error' in read || lines.length > 0)
  const removable = isRemovableWorktreePath(repoRoot, entry.path)

  return {
    path: entry.path,
    relPath: relativePath(repoRoot, entry.path) || entry.path,
    branch: entry.branch,
    detached: entry.detached,
    exists,
    dirty,
    dirtyCount: lines.length,
    locked: entry.locked,
    lockReason: entry.lockReason,
    removable,
    blockedBy: !removable
      ? 'outside_policy'
      : entry.locked
        ? 'locked'
        : entry.detached
          ? 'detached'
          : dirty
            ? 'dirty'
            : null,
  }
}

export function findTaskWorktree(repoRoot: string, taskId: string): FindWorktreeResult {
  const listed = runGit(['-C', repoRoot, 'worktree', 'list', '--porcelain'], {
    timeout: GIT_READ_TIMEOUT_MS,
  })
  if (listed.status !== 0) {
    return {
      ok: false,
      status: 500,
      error: 'git_failed',
      detail: formatGitFailure(listed, 'git worktree list'),
    }
  }

  const match = matchWorktreeForTask(parseWorktreeList(listed.stdout), taskId)
  if (match.ambiguous) {
    return { ok: true, worktree: null, ambiguous: true, candidates: match.candidates }
  }
  if (!match.entry) return { ok: true, worktree: null, ambiguous: false, candidates: [] }

  return {
    ok: true,
    ambiguous: false,
    candidates: [],
    worktree: buildWorktreeView(repoRoot, match.entry),
  }
}

export type RemoveWorktreeResult =
  | { ok: true; path: string; branch: string | null; prunedOnly: boolean }
  | { ok: false; status: 404; error: 'worktree_not_found' }
  | { ok: false; status: 409; error: 'worktree_ambiguous'; candidates: string[] }
  | {
      ok: false
      status: 409
      error: 'worktree_dirty'
      path: string
      dirtyFiles: string[]
      dirtyCount: number
    }
  | { ok: false; status: 409; error: 'worktree_locked'; path: string; lockReason: string | null }
  | { ok: false; status: 409; error: 'worktree_detached'; path: string }
  | { ok: false; status: 403; error: 'worktree_outside_policy'; path: string }
  | {
      ok: false
      status: 500
      error: 'worktree_remove_failed' | 'git_failed'
      path?: string
      detail: string
    }

const DIRTY_SAMPLE_LIMIT = 10

type RemovalBlocker = Extract<RemoveWorktreeResult, { ok: false }>

/**
 * First reason that must stop a removal — outside policy, locked, detached,
 * uncommitted changes; a failed `git status` returns `git_failed`.
 */
export function findRemovalBlocker(wt: WorktreeView): RemovalBlocker | null {
  if (!wt.removable) {
    return { ok: false, status: 403, error: 'worktree_outside_policy', path: wt.path }
  }
  if (wt.locked) {
    return {
      ok: false,
      status: 409,
      error: 'worktree_locked',
      path: wt.path,
      lockReason: wt.lockReason,
    }
  }
  // xem docs/architecture/code/monitor.md §16
  if (wt.detached) {
    return { ok: false, status: 409, error: 'worktree_detached', path: wt.path }
  }
  if (!wt.exists) return null

  const read = readDirtyLines(wt.path)
  if ('error' in read) {
    return { ok: false, status: 500, error: 'git_failed', path: wt.path, detail: read.error }
  }
  if (read.lines.length > 0) {
    return {
      ok: false,
      status: 409,
      error: 'worktree_dirty',
      path: wt.path,
      dirtyFiles: read.lines.slice(0, DIRTY_SAMPLE_LIMIT),
      dirtyCount: read.lines.length,
    }
  }
  return null
}

/**
 * Remove the worktree of `taskId` (the branch is kept); the target is resolved
 * from git, never taken from the caller.
 * xem docs/architecture/code/monitor.md §16
 */
export function removeTaskWorktree(repoRoot: string, taskId: string): RemoveWorktreeResult {
  const found = findTaskWorktree(repoRoot, taskId)
  if ('error' in found) {
    return { ok: false, status: 500, error: 'git_failed', detail: found.detail }
  }
  if (found.ambiguous) {
    return { ok: false, status: 409, error: 'worktree_ambiguous', candidates: found.candidates }
  }
  const wt = found.worktree
  if (!wt) return { ok: false, status: 404, error: 'worktree_not_found' }

  const blocked = findRemovalBlocker(wt)
  if (blocked) return blocked

  if (wt.exists) {
    const removed = runGit(['-C', repoRoot, 'worktree', 'remove', wt.path], {
      timeout: GIT_WRITE_TIMEOUT_MS,
    })
    if (removed.status !== 0) {
      return {
        ok: false,
        status: 500,
        error: 'worktree_remove_failed',
        path: wt.path,
        detail: formatGitFailure(removed, 'git worktree remove'),
      }
    }
  }

  const pruned = runGit(['-C', repoRoot, 'worktree', 'prune'], { timeout: GIT_WRITE_TIMEOUT_MS })
  if (pruned.status !== 0) {
    console.warn('[monitor] git worktree prune failed:', formatGitFailure(pruned, 'git worktree prune'))
  }

  return { ok: true, path: wt.path, branch: wt.branch, prunedOnly: !wt.exists }
}
