import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  add,
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
  validateProjectPath,
} from '../../server/registry'

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
    expect(ctx.defaultRoot).toBe('/legacy')
    expect(ctx.resolveProjectRoot(null)).toBe('/legacy') // empty registry → legacy fallback
  })
})
