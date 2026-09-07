import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../../src/api/apiServer.js'
import { on } from '../../../../src/core/events/index.js'
import type { RegistryContext } from '../../../../src/core/http/types.js'

// Route contract for GET/DELETE /api/tasks/:id/worktree (T161678b4). The whole
// point of the feature is what git actually does, so these run against a real
// repo in tmpdir — a mocked git would only test the mock.

const hasGit = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0

let repo: string
let root: string
/** Deep dir neither inside the repo nor a sibling of it — the policy refuses it. */
let outsideRoot: string
let app: Awaited<ReturnType<typeof createApp>>
const savedEnv = { ...process.env }

function fakeCtx(): RegistryContext {
  return {
    defaultRoot: root,
    resolveProjectRoot: (id: string | null) => (id ? null : root),
    registry: {
      list: () => ({ projects: [], defaultId: null }),
      get: () => null,
      add: () => ({ ok: false, status: 400, error: 'stub' }) as any,
      remove: () => ({ ok: false, status: 400, error: 'stub' }) as any,
      validateProjectPath: (() => ({ ok: false, status: 400, error: 'stub' })) as any,
      seedDefault: () => null,
    },
  }
}

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', cwd: repo })
}

function seedTask(taskId: string, state: Record<string, unknown> = { current_phase: 'completed' }) {
  fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
  fs.writeFileSync(
    path.join(root, '.dev-state', `${taskId}.json`),
    JSON.stringify({ task_id: taskId, ...state }, null, 2),
    'utf8',
  )
}

/** Add a linked worktree at `<repo>/.claude/worktrees/<dir>` on a fresh branch. */
function addWorktree(dir: string, branch: string): string {
  const target = path.join(repo, '.claude', 'worktrees', dir)
  git('worktree', 'add', '-b', branch, target)
  return target
}

function worktreePaths(): string[] {
  return git('worktree', 'list', '--porcelain')
    .split(/\r?\n/)
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length))
}

beforeAll(async () => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-wt-route-')))
  outsideRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-wt-outside-')))
  // `root` is the data root the controller receives — <repo>/.dev-team-agent.
  root = path.join(repo, '.dev-team-agent')
  fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
  process.env.DEV_TEAM_DASHBOARD_HOME = path.join(repo, '.home')

  if (hasGit) {
    git('init', '-b', 'main', repo)
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    fs.writeFileSync(path.join(repo, 'README.md'), '# fixture\n', 'utf8')
    git('add', 'README.md')
    git('commit', '-m', 'init')
  }
  app = await createApp(fakeCtx())
})

afterAll(() => {
  process.env = savedEnv
  fs.rmSync(repo, { recursive: true, force: true })
  fs.rmSync(outsideRoot, { recursive: true, force: true })
})

// The id guard runs before any git call, so it holds with or without git.
describe('/api/tasks/:id/worktree — task id guard', () => {
  test('400: GET rejects a path-traversal task id', async () => {
    const res = await app.request(`/api/tasks/${encodeURIComponent('../../etc')}/worktree`)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid task id')
  })

  test('400: DELETE rejects a path-traversal task id', async () => {
    const res = await app.request(`/api/tasks/${encodeURIComponent('../../etc')}/worktree`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid task id')
  })
})

describe.skipIf(!hasGit)('GET /api/tasks/:id/worktree', () => {
  test('200: reports a clean worktree matched by branch name', async () => {
    seedTask('W1')
    addWorktree('W1dir', 'fix/W1/demo')

    const res = await app.request('/api/tasks/W1/worktree')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.taskId).toBe('W1')
    expect(body.ambiguous).toBe(false)
    expect(body.worktree.branch).toBe('fix/W1/demo')
    expect(body.worktree.exists).toBe(true)
    expect(body.worktree.dirty).toBe(false)
    expect(body.worktree.removable).toBe(true)
    expect(body.worktree.blockedBy).toBeNull()
    expect(body.worktree.relPath).toBe(path.join('.claude', 'worktrees', 'W1dir'))
  })

  test('200: a task with no worktree reports null, not an error', async () => {
    seedTask('Wnone')
    const res = await app.request('/api/tasks/Wnone/worktree')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.worktree).toBeNull()
    expect(body.ambiguous).toBe(false)
  })

  test('200: reports uncommitted changes as dirty and blocked', async () => {
    seedTask('W2')
    const wt = addWorktree('W2', 'fix/W2/dirty')
    fs.writeFileSync(path.join(wt, 'scratch.txt'), 'not committed\n', 'utf8')

    const body = await (await app.request('/api/tasks/W2/worktree')).json()
    expect(body.worktree.dirty).toBe(true)
    expect(body.worktree.dirtyCount).toBeGreaterThanOrEqual(1)
    expect(body.worktree.blockedBy).toBe('dirty')
  })

  test('200: never reports the main worktree for a task named after it', async () => {
    seedTask('main')
    const body = await (await app.request('/api/tasks/main/worktree')).json()
    expect(body.worktree).toBeNull()
  })
})

describe.skipIf(!hasGit)('DELETE /api/tasks/:id/worktree', () => {
  test('200: removes a clean worktree, prunes it, and keeps the branch', async () => {
    seedTask('D1')
    const wt = addWorktree('D1', 'fix/D1/clean')

    const res = await app.request('/api/tasks/D1/worktree', { method: 'DELETE' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.removed).toBe(wt)
    expect(body.branch).toBe('fix/D1/clean')
    expect(body.prunedOnly).toBe(false)

    expect(fs.existsSync(wt)).toBe(false)
    expect(worktreePaths()).not.toContain(wt)
    // Prune ran — no leftover admin dir under .git/worktrees.
    expect(fs.existsSync(path.join(repo, '.git', 'worktrees', 'D1'))).toBe(false)
    // The branch (and every commit on it) survives.
    expect(git('branch', '--list', 'fix/D1/clean').trim()).toContain('fix/D1/clean')
  })

  test('409: refuses a dirty worktree and leaves it in place', async () => {
    seedTask('D2')
    const wt = addWorktree('D2', 'fix/D2/dirty')
    fs.writeFileSync(path.join(wt, 'scratch.txt'), 'not committed\n', 'utf8')

    const res = await app.request('/api/tasks/D2/worktree', { method: 'DELETE' })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('worktree_dirty')
    expect(body.dirtyFiles.length).toBeGreaterThanOrEqual(1)
    expect(body.dirtyCount).toBeGreaterThanOrEqual(1)
    expect(fs.existsSync(wt)).toBe(true)
    expect(worktreePaths()).toContain(wt)
  })

  test('404: a task with no worktree', async () => {
    seedTask('D3')
    const res = await app.request('/api/tasks/D3/worktree', { method: 'DELETE' })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('worktree_not_found')
  })

  test('409: refuses a task that has not finished, worktree untouched', async () => {
    seedTask('D4', { current_phase: 'implementer' })
    const wt = addWorktree('D4', 'fix/D4/running')

    const res = await app.request('/api/tasks/D4/worktree', { method: 'DELETE' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('task_not_finished')
    expect(fs.existsSync(wt)).toBe(true)
    expect(worktreePaths()).toContain(wt)
  })

  test('200: an archived task counts as finished', async () => {
    seedTask('D5', { current_phase: 'implementer', archived: true })
    const wt = addWorktree('D5', 'fix/D5/archived')

    const res = await app.request('/api/tasks/D5/worktree', { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(fs.existsSync(wt)).toBe(false)
  })

  test('200: a worktree already rm -rf-ed by hand only needs a prune', async () => {
    seedTask('D6')
    const wt = addWorktree('D6', 'fix/D6/gone')
    fs.rmSync(wt, { recursive: true, force: true })

    const res = await app.request('/api/tasks/D6/worktree', { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect((await res.json()).prunedOnly).toBe(true)
    expect(worktreePaths()).not.toContain(wt)
  })

  test('404: deleting twice is safe — the second call reports nothing to remove', async () => {
    seedTask('D7')
    addWorktree('D7', 'fix/D7/twice')

    expect((await app.request('/api/tasks/D7/worktree', { method: 'DELETE' })).status).toBe(200)
    const second = await app.request('/api/tasks/D7/worktree', { method: 'DELETE' })
    expect(second.status).toBe(404)
    expect((await second.json()).error).toBe('worktree_not_found')
  })

  test('removes only the worktree of the requested task', async () => {
    seedTask('D8')
    seedTask('D9')
    const keep = addWorktree('D9', 'fix/D9/keep')
    const drop = addWorktree('D8', 'fix/D8/drop')

    expect((await app.request('/api/tasks/D8/worktree', { method: 'DELETE' })).status).toBe(200)
    expect(fs.existsSync(drop)).toBe(false)
    expect(fs.existsSync(keep)).toBe(true)
    expect(worktreePaths()).toContain(repo)
  })
})

// Error branches and the invariants the docs promise. Each one is a path a user
// can hit from the button, so each gets an end-to-end assertion.
describe.skipIf(!hasGit)('DELETE /api/tasks/:id/worktree — refusals', () => {
  test('409: refuses a locked worktree and names the reason', async () => {
    seedTask('D10')
    const wt = addWorktree('D10', 'fix/D10/locked')
    git('worktree', 'lock', '--reason', 'in use', wt)

    const res = await app.request('/api/tasks/D10/worktree', { method: 'DELETE' })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('worktree_locked')
    expect(body.lockReason).toBe('in use')
    expect(fs.existsSync(wt)).toBe(true)

    git('worktree', 'unlock', wt)
  })

  test('403: refuses a worktree outside the repo and its sibling dirs', async () => {
    seedTask('D11')
    const outside = path.join(outsideRoot, 'nested', 'D11')
    fs.mkdirSync(path.dirname(outside), { recursive: true })
    git('worktree', 'add', '-b', 'fix/D11/outside', outside)

    const res = await app.request('/api/tasks/D11/worktree', { method: 'DELETE' })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('worktree_outside_policy')
    expect(fs.existsSync(outside)).toBe(true)

    git('worktree', 'remove', '--force', outside)
  })

  test('409: unreadable task state counts as "still running", worktree untouched', async () => {
    seedTask('D12')
    const wt = addWorktree('D12', 'fix/D12/nostate')
    // Same shape as a half-written record from the orchestrator: the dashboard
    // cannot prove the task ended, so it must not remove anything.
    fs.rmSync(path.join(root, '.dev-state', 'D12.json'))

    const res = await app.request('/api/tasks/D12/worktree', { method: 'DELETE' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('task_not_finished')
    expect(fs.existsSync(wt)).toBe(true)
  })

  test('409: a modified tracked file blocks removal', async () => {
    seedTask('D13')
    const wt = addWorktree('D13', 'fix/D13/modified')
    fs.writeFileSync(path.join(wt, 'README.md'), '# edited\n', 'utf8')

    const res = await app.request('/api/tasks/D13/worktree', { method: 'DELETE' })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('worktree_dirty')
    expect(body.dirtyFiles.join(' ')).toContain('README.md')
    expect(fs.existsSync(wt)).toBe(true)
  })

  test('409: a deleted tracked file blocks removal', async () => {
    seedTask('D14')
    const wt = addWorktree('D14', 'fix/D14/deleted')
    fs.rmSync(path.join(wt, 'README.md'))

    const res = await app.request('/api/tasks/D14/worktree', { method: 'DELETE' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('worktree_dirty')
    expect(fs.existsSync(wt)).toBe(true)
  })

  test('200: cleaning the worktree makes the retry succeed', async () => {
    seedTask('D15')
    const wt = addWorktree('D15', 'fix/D15/retry')
    const scratch = path.join(wt, 'scratch.txt')
    fs.writeFileSync(scratch, 'wip\n', 'utf8')

    expect((await app.request('/api/tasks/D15/worktree', { method: 'DELETE' })).status).toBe(409)
    fs.rmSync(scratch)
    expect((await app.request('/api/tasks/D15/worktree', { method: 'DELETE' })).status).toBe(200)
    expect(fs.existsSync(wt)).toBe(false)
  })
})

// The event is a published contract (docs/event-catalog.md) — without a test
// nothing catches its removal.
describe.skipIf(!hasGit)('DELETE /api/tasks/:id/worktree — domain event', () => {
  test('emits entity.deleted for the worktree after git succeeded', async () => {
    seedTask('D16')
    const wt = addWorktree('D16', 'fix/D16/event')
    const seen: Record<string, unknown>[] = []
    const off = on('entity.deleted', (e) => {
      seen.push(e.payload)
    })

    try {
      expect((await app.request('/api/tasks/D16/worktree', { method: 'DELETE' })).status).toBe(200)
    } finally {
      off()
    }

    const worktreeEvents = seen.filter((p) => p.entity === 'worktree')
    expect(worktreeEvents).toHaveLength(1)
    expect(worktreeEvents[0].id).toBe('D16')
    expect((worktreeEvents[0].detail as any).path).toBe(wt)
    expect((worktreeEvents[0].detail as any).prunedOnly).toBe(false)
  })

  test('a refused removal emits nothing', async () => {
    seedTask('D17')
    const wt = addWorktree('D17', 'fix/D17/silent')
    fs.writeFileSync(path.join(wt, 'scratch.txt'), 'wip\n', 'utf8')
    const seen: unknown[] = []
    const off = on('entity.deleted', (e) => {
      if ((e.payload as any).entity === 'worktree') seen.push(e.payload)
    })

    try {
      expect((await app.request('/api/tasks/D17/worktree', { method: 'DELETE' })).status).toBe(409)
    } finally {
      off()
    }
    expect(seen).toHaveLength(0)
  })
})
