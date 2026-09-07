import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import {
  isRemovableWorktreePath,
  matchWorktreeForTask,
  parseWorktreeList,
  type WorktreeEntry,
} from '../../../../../src/features/monitor/business/worktree.js'

// `git worktree list --porcelain` output captured from git 2.47.3 on this repo.
const PORCELAIN = `worktree /data/project/agent-workflow
HEAD 337075da8b2c1f0e5f4a2b9c8d7e6f5a4b3c2d1e
branch refs/heads/dev/1.1.3/main

worktree /data/project/agent-workflow/.claude/worktrees/T137851df
HEAD 228aae1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e
branch refs/heads/fix/T137851df/usage-stats-cache-mtime

worktree /data/project/agent-workflow/.claude/worktrees/issue-209-item-1
HEAD 263c45f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7
detached
`

function entry(over: Partial<WorktreeEntry> = {}): WorktreeEntry {
  return {
    path: '/repo/.claude/worktrees/x',
    branch: null,
    head: null,
    detached: false,
    bare: false,
    locked: false,
    lockReason: null,
    prunable: false,
    isMain: false,
    ...over,
  }
}

describe('parseWorktreeList', () => {
  test('splits real porcelain output into one entry per block', () => {
    const entries = parseWorktreeList(PORCELAIN)
    expect(entries).toHaveLength(3)
    expect(entries.map((e) => e.path)).toEqual([
      '/data/project/agent-workflow',
      '/data/project/agent-workflow/.claude/worktrees/T137851df',
      '/data/project/agent-workflow/.claude/worktrees/issue-209-item-1',
    ])
  })

  test('marks only the first block as the main worktree', () => {
    const entries = parseWorktreeList(PORCELAIN)
    expect(entries.map((e) => e.isMain)).toEqual([true, false, false])
  })

  test('strips the refs/heads/ prefix from branch', () => {
    expect(parseWorktreeList(PORCELAIN)[1].branch).toBe('fix/T137851df/usage-stats-cache-mtime')
  })

  test('a detached block has no branch', () => {
    const detached = parseWorktreeList(PORCELAIN)[2]
    expect(detached.detached).toBe(true)
    expect(detached.branch).toBeNull()
  })

  test('locked keeps its reason, and a bare reason-less lock is still locked', () => {
    const entries = parseWorktreeList(
      'worktree /repo\nHEAD abc\nbranch refs/heads/main\n\n' +
        'worktree /repo/wt-a\nHEAD def\nbranch refs/heads/a\nlocked being worked on\n\n' +
        'worktree /repo/wt-b\nHEAD 123\nbranch refs/heads/b\nlocked\n',
    )
    expect(entries[1].locked).toBe(true)
    expect(entries[1].lockReason).toBe('being worked on')
    expect(entries[2].locked).toBe(true)
    expect(entries[2].lockReason).toBeNull()
  })

  test('reads the bare and prunable flags', () => {
    const entries = parseWorktreeList(
      'worktree /repo/bare.git\nHEAD abc\nbare\n\n' +
        'worktree /repo/wt-gone\nHEAD def\nbranch refs/heads/gone\nprunable gitdir file points to non-existent location\n',
    )
    expect(entries[0].bare).toBe(true)
    expect(entries[1].prunable).toBe(true)
  })

  test('empty stdout yields no entries', () => {
    expect(parseWorktreeList('')).toEqual([])
    expect(parseWorktreeList('   \n\n  \n')).toEqual([])
  })

  test('CRLF line endings parse the same as LF', () => {
    const crlf = PORCELAIN.replace(/\n/g, '\r\n')
    expect(parseWorktreeList(crlf)).toEqual(parseWorktreeList(PORCELAIN))
  })

  test('a block without a worktree path is dropped without shifting isMain', () => {
    const entries = parseWorktreeList('HEAD abc\nbranch refs/heads/orphan\n\nworktree /repo\nHEAD def\n')
    expect(entries).toHaveLength(1)
    expect(entries[0].isMain).toBe(true)
  })
})

describe('matchWorktreeForTask', () => {
  const entries = parseWorktreeList(PORCELAIN)

  test('matches on an exact directory name', () => {
    const m = matchWorktreeForTask(entries, 'T137851df')
    expect(m.ambiguous).toBe(false)
    expect(m.entry?.path).toBe('/data/project/agent-workflow/.claude/worktrees/T137851df')
  })

  test('falls back to the task id inside the branch name', () => {
    const list = [
      entry({ path: '/repo/.claude/worktrees/free+name', branch: 'fix/T137851df/foo' }),
      entry({ path: '/repo/.claude/worktrees/other', branch: 'dev/1.1.2/T2706f166_bar' }),
    ]
    expect(matchWorktreeForTask(list, 'T137851df')?.entry?.branch).toBe('fix/T137851df/foo')
    expect(matchWorktreeForTask(list, 'T2706f166')?.entry?.branch).toBe('dev/1.1.2/T2706f166_bar')
  })

  test('does not match a task id that is only a prefix of the branch segment', () => {
    const list = [entry({ path: '/repo/wt', branch: 'fix/T137851dfXX/foo' })]
    const m = matchWorktreeForTask(list, 'T137851df')
    expect(m.entry).toBeNull()
    expect(m.ambiguous).toBe(false)
  })

  test('never returns the main worktree, even when its name matches', () => {
    const list = [entry({ path: '/repo/T1', isMain: true, branch: 'dev/1.1.3/main' })]
    expect(matchWorktreeForTask(list, 'T1').entry).toBeNull()
  })

  test('never returns a bare repo entry', () => {
    const list = [
      entry({ path: '/repo/main', isMain: true }),
      entry({ path: '/repo/T1', bare: true }),
    ]
    expect(matchWorktreeForTask(list, 'T1').entry).toBeNull()
  })

  test('two branch candidates are ambiguous — nothing is picked', () => {
    const list = [
      entry({ path: '/repo/a', branch: 'fix/T1/one' }),
      entry({ path: '/repo/b', branch: 'feat/T1/two' }),
    ]
    const m = matchWorktreeForTask(list, 'T1')
    expect(m.entry).toBeNull()
    expect(m.ambiguous).toBe(true)
    expect(m.candidates).toEqual(['/repo/a', '/repo/b'])
  })

  test('no candidate at all is not ambiguous', () => {
    const m = matchWorktreeForTask(entries, 'Tzzzzzzzz')
    expect(m).toEqual({ entry: null, ambiguous: false, candidates: [] })
  })
})

describe('isRemovableWorktreePath', () => {
  const repo = path.resolve('/data/project/agent-workflow')

  test('accepts a worktree inside the repo', () => {
    expect(isRemovableWorktreePath(repo, path.join(repo, '.claude', 'worktrees', 'X'))).toBe(true)
  })

  test('accepts a sibling of the repo', () => {
    expect(isRemovableWorktreePath(repo, path.join(path.dirname(repo), 'wt-X'))).toBe(true)
  })

  test('refuses the repo root itself', () => {
    expect(isRemovableWorktreePath(repo, repo)).toBe(false)
  })

  test('refuses an ancestor of the repo', () => {
    expect(isRemovableWorktreePath(repo, path.dirname(repo))).toBe(false)
  })

  test('refuses an unrelated absolute path', () => {
    expect(isRemovableWorktreePath(repo, '/tmp/random-worktree')).toBe(false)
  })

  test('refuses a path that escapes both the repo and its parent', () => {
    expect(isRemovableWorktreePath(repo, path.join(repo, '..', '..', 'elsewhere', 'x'))).toBe(false)
  })

  test('refuses empty inputs', () => {
    expect(isRemovableWorktreePath(repo, '')).toBe(false)
    expect(isRemovableWorktreePath('', repo)).toBe(false)
  })
})
