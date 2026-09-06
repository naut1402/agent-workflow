/**
 * Worktree capability for monitor: read the git worktree bound to a task and
 * remove it on demand (`git worktree remove` + `prune`).
 *
 * Never removes the branch — the branch is what keeps unmerged commits safe,
 * which is why removal does not have to prove the task was merged.
 */

import {
  basename,
  dirname,
  existsSync,
  relativePath,
  resolvePath,
  resolvePathUnder,
} from '../../../core/lib/fileHelper.js'
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

/**
 * Parse `git worktree list --porcelain` (verified against git 2.47.3): blocks
 * separated by a blank line, each line `<key> <rest>`; `detached` / `bare` /
 * `prunable` / `locked` may appear without a value.
 */
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
    for (const line of lines) {
      const sp = line.indexOf(' ')
      const key = sp === -1 ? line : line.slice(0, sp)
      const value = sp === -1 ? '' : line.slice(sp + 1).trim()
      switch (key) {
        case 'worktree':
          entry.path = value
          break
        case 'HEAD':
          entry.head = value || null
          break
        case 'branch':
          entry.branch = value.replace(/^refs\/heads\//, '') || null
          break
        case 'detached':
          entry.detached = true
          break
        case 'bare':
          entry.bare = true
          break
        case 'prunable':
          entry.prunable = true
          break
        case 'locked':
          entry.locked = true
          entry.lockReason = value || null
          break
        default:
          break
      }
    }
    // A block without a path is not a worktree — `isMain` must not shift, so
    // only blocks that made it into `entries` count as "first".
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
 * Map a task to its worktree in two tiers: exact directory name first, then
 * task id inside the branch name (`fix/T1/foo`, `dev/1.1.2/T1_bar`).
 * `taskId` must already be `/[\w-]+/` (controller guard) so it is safe to
 * interpolate into a RegExp.
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
 * Second line of defence behind `git worktree remove` (which already refuses
 * paths it does not own): accept only worktrees inside the repo
 * (`<repo>/.claude/worktrees/<name>`, what the agent harness creates) or right
 * next to it (`../wt-<task>`, what `git-worktree.md` recommends).
 */
export function isRemovableWorktreePath(repoRoot: string, wtPath: string): boolean {
  if (!repoRoot || !wtPath) return false
  const base = resolvePath(repoRoot)
  const target = resolvePath(wtPath)

  if (target === base) return false
  // Ancestor of the repo — removing it would take the main worktree with it.
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
  blockedBy: 'dirty' | 'locked' | 'outside_policy' | null
}

export type FindWorktreeResult =
  | { ok: true; worktree: WorktreeView | null; ambiguous: boolean; candidates: string[] }
  | { ok: false; status: 500; error: 'git_failed'; detail: string }

/** Uncommitted changes in a worktree; git failure counts as dirty (do not guess). */
function readDirtyLines(wtPath: string): { ok: boolean; lines: string[] } {
  // --no-optional-locks: never write index.lock into a worktree someone else uses.
  const res = runGit(['--no-optional-locks', '-C', wtPath, 'status', '--porcelain'], {
    timeout: GIT_READ_TIMEOUT_MS,
  })
  if (res.status !== 0) return { ok: false, lines: [] }
  return { ok: true, lines: String(res.stdout ?? '').split(/\r?\n/).filter(Boolean) }
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

  const entry = match.entry
  const exists = existsSync(entry.path)
  const status = exists ? readDirtyLines(entry.path) : { ok: true, lines: [] as string[] }
  const dirty = exists && (!status.ok || status.lines.length > 0)
  const removable = isRemovableWorktreePath(repoRoot, entry.path)

  return {
    ok: true,
    ambiguous: false,
    candidates: [],
    worktree: {
      path: entry.path,
      relPath: relativePath(repoRoot, entry.path) || entry.path,
      branch: entry.branch,
      detached: entry.detached,
      exists,
      dirty,
      dirtyCount: status.lines.length,
      locked: entry.locked,
      lockReason: entry.lockReason,
      removable,
      blockedBy: !removable ? 'outside_policy' : entry.locked ? 'locked' : dirty ? 'dirty' : null,
    },
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
  | { ok: false; status: 403; error: 'worktree_outside_policy'; path: string }
  | {
      ok: false
      status: 500
      error: 'worktree_remove_failed' | 'git_failed'
      path?: string
      detail: string
    }

/** Max dirty paths echoed back to the UI — the list is a hint, not a report. */
const DIRTY_SAMPLE_LIMIT = 10

/**
 * Remove the worktree of `taskId`. The target is resolved here from git, never
 * taken from the caller — a client-supplied path would be an attack surface.
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
  if (wt.exists) {
    // Re-run status here (instead of reusing the count) to name the files.
    const status = readDirtyLines(wt.path)
    if (!status.ok || status.lines.length > 0) {
      return {
        ok: false,
        status: 409,
        error: 'worktree_dirty',
        path: wt.path,
        dirtyFiles: status.lines.slice(0, DIRTY_SAMPLE_LIMIT),
        dirtyCount: status.lines.length,
      }
    }

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

  // Prune always runs; a prune failure does not undo a successful removal.
  const pruned = runGit(['-C', repoRoot, 'worktree', 'prune'], { timeout: GIT_WRITE_TIMEOUT_MS })
  if (pruned.status !== 0) {
    console.warn('[monitor] git worktree prune failed:', formatGitFailure(pruned, 'git worktree prune'))
  }

  return { ok: true, path: wt.path, branch: wt.branch, prunedOnly: !wt.exists }
}
