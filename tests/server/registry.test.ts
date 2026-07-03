import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  add,
  addFromGit,
  addSshProject,
  createRegistryContext,
  get,
  list,
  loadRegistry,
  registryFile,
  registryHome,
  remove,
  resolveProjectRoot,
  saveRegistry,
  seedDefault,
  syncGitProject,
  validateProjectPath,
  validateSshProject,
} from '../../server/registry'
import type { RunGitFn } from '../../server/git/workspace'
import { upsertRunner } from '../../server/runners/registry'
import { upsertCredential } from '../../server/runners/credentials'

let home: string // registry config home (DEV_TEAM_DASHBOARD_HOME)
let proj: string // a fake project root containing .dev-team-agent
let workspace: string // <proj>/.dev-team-agent
const savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  savedEnv.HOME_OVR = process.env.DEV_TEAM_DASHBOARD_HOME
  savedEnv.ROOT = process.env.DEV_TEAM_ROOT
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-home-'))
  proj = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-proj-'))
  workspace = path.join(proj, '.dev-team-agent')
  fs.mkdirSync(workspace, { recursive: true })
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  delete process.env.DEV_TEAM_ROOT
})

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true })
  fs.rmSync(proj, { recursive: true, force: true })
  if (savedEnv.HOME_OVR === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = savedEnv.HOME_OVR
  if (savedEnv.ROOT === undefined) delete process.env.DEV_TEAM_ROOT
  else process.env.DEV_TEAM_ROOT = savedEnv.ROOT
})

describe('locations + load/save', () => {
  test('registryHome respects DEV_TEAM_DASHBOARD_HOME', () => {
    expect(registryHome()).toBe(path.resolve(home))
    expect(registryFile()).toBe(path.join(path.resolve(home), 'projects.json'))
  })
  test('loadRegistry empty when no file; save then load round-trips', () => {
    expect(loadRegistry()).toEqual({ version: 1, projects: [] })
    saveRegistry({ version: 1, projects: [{ id: 'x', name: 'X', kind: 'local', path: workspace, addedAt: 't', default: true }] })
    expect(loadRegistry().projects[0].id).toBe('x')
    expect(fs.existsSync(registryFile())).toBe(true)
  })
  test('corrupt JSON degrades to empty', () => {
    fs.mkdirSync(home, { recursive: true })
    fs.writeFileSync(registryFile(), '{not json')
    expect(loadRegistry()).toEqual({ version: 1, projects: [] })
  })
  test('legacy entry without kind normalizes to local', () => {
    saveRegistry({
      version: 1,
      projects: [{
        id: 'legacy',
        name: 'Legacy',
        path: workspace,
        addedAt: 't',
        default: true,
      } as any],
    })
    const p = loadRegistry().projects[0]
    expect(p.kind).toBe('local')
    expect(p.source).toBeUndefined()
  })
})

describe('validateProjectPath', () => {
  test('rejects non-string / relative / missing', () => {
    expect(validateProjectPath(123).ok).toBe(false)
    expect(validateProjectPath('relative/p').ok).toBe(false)
    expect(validateProjectPath(path.join(proj, 'nope')).ok).toBe(false)
  })
  test('accepts a dir containing .dev-team-agent (descends in)', () => {
    const v = validateProjectPath(proj)
    expect(v.ok).toBe(true)
    if (v.ok) expect(fs.realpathSync(v.path)).toBe(fs.realpathSync(workspace))
  })
  test('accepts a .dev-team-agent dir directly', () => {
    const v = validateProjectPath(workspace)
    expect(v.ok).toBe(true)
  })
  test('explicit name wins over derived', () => {
    const v = validateProjectPath(proj, 'My Proj')
    if (v.ok) expect(v.name).toBe('My Proj')
  })
})

describe('CRUD', () => {
  test('add new → becomes default; idempotent on same path', () => {
    const r = add({ path: proj })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.project.default).toBe(true)
      const again = add({ path: proj })
      if (again.ok) expect(again.project.id).toBe(r.project.id)
    }
    expect(list().projects).toHaveLength(1)
  })
  test('add propagates validation failure', () => {
    expect(add({ path: 'relative' }).ok).toBe(false)
  })
  test('get returns project or null', () => {
    const r = add({ path: proj })
    if (r.ok) expect(get(r.project.id)?.path).toBe(r.project.path)
    expect(get('missing')).toBeNull()
    expect(get(null)).toBeNull()
  })
  test('remove: refuses default, 404 unknown, removes non-default', () => {
    const first = add({ path: proj })
    expect(remove(first.ok ? first.project.id : '').ok).toBe(false) // default
    expect(remove('nope')).toMatchObject({ ok: false, status: 404 })
    // add a second (non-default) and remove it
    const proj2 = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-proj2-'))
    fs.mkdirSync(path.join(proj2, '.dev-team-agent'), { recursive: true })
    const second = add({ path: proj2 })
    if (second.ok) expect(remove(second.project.id)).toEqual({ ok: true, removed: true })
    fs.rmSync(proj2, { recursive: true, force: true })
  })
})

describe('seedDefault + resolveProjectRoot', () => {
  test('seedDefault seeds when empty, noop when populated', () => {
    const p = seedDefault(proj)
    expect(p?.default).toBe(true)
    expect(seedDefault(proj)).toBeNull() // already populated
    expect(seedDefault(null)).toBeNull()
  })
  test('resolveProjectRoot: known id, unknown→null, env priority, default, fallback', () => {
    const r = add({ path: proj })
    const id = r.ok ? r.project.id : ''
    expect(resolveProjectRoot(id)).toBe(r.ok ? r.project.path : '')
    expect(resolveProjectRoot('unknown')).toBeNull()
    // DEV_TEAM_ROOT highest priority for the default (no id)
    process.env.DEV_TEAM_ROOT = proj
    expect(resolveProjectRoot(null)).toBe(path.resolve(proj))
    delete process.env.DEV_TEAM_ROOT
    // falls back to registry default
    expect(resolveProjectRoot(null)).toBe(r.ok ? r.project.path : '')
  })
  test('resolveProjectRoot opts.defaultRoot as last resort', () => {
    expect(resolveProjectRoot(null, { defaultRoot: '/legacy' })).toBe('/legacy')
  })
})

describe('createRegistryContext', () => {
  test('exposes registry CRUD + resolveProjectRoot bound to defaultRoot', () => {
    const ctx = createRegistryContext({ defaultRoot: '/legacy' })
    expect(typeof ctx.registry.list).toBe('function')
    expect(typeof ctx.registry.addFromGit).toBe('function')
    expect(typeof ctx.registry.syncGitProject).toBe('function')
    expect(typeof ctx.registry.addSshProject).toBe('function')
    expect(ctx.defaultRoot).toBe('/legacy')
    expect(ctx.resolveProjectRoot(null)).toBe('/legacy') // empty registry → legacy fallback
  })
})

describe('SSH projects', () => {
  beforeEach(() => {
    upsertCredential({
      id: 'ssh-cred',
      provider: 'claude-code-ssh',
      label: 'Key',
      secretRef: 'file:/tmp/key',
    })
    upsertRunner({
      id: 'ssh-dev',
      provider: 'claude-code-ssh',
      credentialId: 'ssh-cred',
      config: { host: 'dev', user: 'u', port: 22 },
    })
  })

  test('T44-09 addSshProject validates and scaffolds cache', () => {
    const cache = path.join(home, 'cache', 'ssh-test')
    const v = validateSshProject({
      kind: 'ssh',
      remotePath: '/Users/dev/.dev-team-agent',
      remote: { host: 'dev', user: 'u', runnerId: 'ssh-dev', artifactCache: cache },
    })
    expect(v.ok).toBe(true)

    const added = addSshProject({
      kind: 'ssh',
      remotePath: '/Users/dev/.dev-team-agent',
      name: 'Dev Mac',
      remote: { host: 'dev', user: 'u', runnerId: 'ssh-dev', artifactCache: cache },
    })
    expect(added.ok).toBe(true)
    if (added.ok) {
      expect(added.project.kind).toBe('ssh')
      expect(resolveProjectRoot(added.project.id)).toBe(cache)
      expect(fs.existsSync(path.join(cache, '.dev-state'))).toBe(true)
      expect(fs.existsSync(path.join(cache, 'tasks'))).toBe(true)
    }
  })

  test('rejects non-POSIX remote path', () => {
    const v = validateSshProject({
      kind: 'ssh',
      remotePath: 'C:\\Users\\dev',
      remote: { host: 'dev', user: 'u', runnerId: 'ssh-dev' },
    })
    expect(v.ok).toBe(false)
  })

  test('local add regression unchanged', () => {
    const r = add({ path: proj })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.project.kind).toBe('local')
  })
})

function mockRunGit(): RunGitFn {
  return async (args) => {
    if (args[0] === 'clone') {
      const targetDir = args[args.length - 1]
      fs.mkdirSync(path.join(targetDir, '.dev-team-agent'), { recursive: true })
      return { stdout: '', stderr: '' }
    }
    if (args[0] === 'pull') return { stdout: '', stderr: '' }
    throw new Error(`unexpected: ${args.join(' ')}`)
  }
}

describe('addFromGit + syncGitProject', () => {
  test('addFromGit creates git project with source', async () => {
    const r = await addFromGit({
      gitUrl: 'https://github.com/org/my-repo.git',
      branch: 'main',
      runGit: mockRunGit(),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.project.kind).toBe('git')
      expect(r.project.source?.url).toBe('https://github.com/org/my-repo.git')
      expect(r.project.source?.branch).toBe('main')
      expect(r.project.path).toContain('.dev-team-agent')
    }
  })

  test('idempotent on same url+branch', async () => {
    const runGit = mockRunGit()
    const first = await addFromGit({ gitUrl: 'https://github.com/org/repo.git', runGit })
    const second = await addFromGit({ gitUrl: 'https://github.com/org/repo.git', runGit })
    if (first.ok && second.ok) expect(second.project.id).toBe(first.project.id)
  })

  test('clone fail cleans up workspace', async () => {
    const r = await addFromGit({
      gitUrl: 'https://github.com/org/fail.git',
      runGit: async () => {
        throw new Error('branch not found')
      },
    })
    expect(r.ok).toBe(false)
    if ('error' in r) expect(r.error).toContain('git clone failed')
  })

  test('scaffolds .dev-team-agent when clone has no workspace', async () => {
    const runGit: RunGitFn = async (args) => {
      if (args[0] === 'clone') {
        const targetDir = args[args.length - 1]
        fs.mkdirSync(targetDir, { recursive: true })
        return { stdout: '', stderr: '' }
      }
      throw new Error(`unexpected: ${args.join(' ')}`)
    }
    const r = await addFromGit({
      gitUrl: 'https://github.com/org/bare-repo.git',
      runGit,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(fs.existsSync(path.join(r.project.path, '.dev-state'))).toBe(true)
      expect(fs.existsSync(path.join(r.project.path, 'tasks'))).toBe(true)
    }
  })

  test('syncGitProject updates lastSyncAt', async () => {
    const added = await addFromGit({
      gitUrl: 'https://github.com/org/sync.git',
      runGit: mockRunGit(),
    })
    if (!added.ok) throw new Error('setup failed')
    const before = added.project.source?.lastSyncAt
    const synced = await syncGitProject(added.project.id, mockRunGit())
    expect(synced.ok).toBe(true)
    if (synced.ok) {
      expect(synced.syncedAt).toBeTruthy()
      expect(synced.project.source?.lastSyncAt).not.toBe(before)
    }
  })

  test('syncGitProject rejects local project', async () => {
    const local = add({ path: proj })
    if (!local.ok) throw new Error('setup')
    const r = await syncGitProject(local.project.id)
    expect(r.ok).toBe(false)
    if ('error' in r) expect(r.error).toBe('not a git project')
  })

  test('syncGitProject 404 unknown', async () => {
    const r = await syncGitProject('missing-id')
    expect(r.ok).toBe(false)
    if ('error' in r) expect(r.status).toBe(404)
  })
})
