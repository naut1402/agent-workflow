import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sanitiseRunnerId, sanitiseCredentialId } from '../../../server/runners/types.js'
import {
  substituteConfig,
  normalizeAgentRef,
  resolveSecretRef,
  loadRunners,
  listRunners,
  getRunner,
  getDefaultRunner,
  upsertRunner,
  deleteRunner,
  setDefaultRunner,
  loadCredentials,
  listCredentials,
  getCredential,
  upsertCredential,
  deleteCredential,
  listProviderIds,
  getProvider,
  submitJob,
  loadJob,
  listJobs,
  cancelJob,
} from '../../../server/runners/index.js'

// Characterization test for the runners execution plane (U0005), written
// against the current JS via the public index surface so it survives the
// .js → .ts migration. Isolates the on-disk store via DEV_TEAM_DASHBOARD_HOME
// and never spawns the real CLI (agentRef has no colon → resolveAgent throws
// before any provider.execute / spawn).

let home: string
const savedEnv = { ...process.env }

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-runners-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
})
beforeEach(() => {
  // Reset the store between tests so CRUD assertions are independent.
  for (const f of ['runners.json', 'credentials.json']) {
    fs.rmSync(path.join(home, f), { force: true })
  }
})

describe('id sanitisers', () => {
  test('strips unsafe chars, caps length, rejects empty/slash', () => {
    expect(sanitiseRunnerId('  My Runner!@# ')).toBe('MyRunner')
    expect(sanitiseRunnerId('a/b')).toBe(null)
    expect(sanitiseRunnerId('a\\b')).toBe(null)
    expect(sanitiseRunnerId('')).toBe(null)
    expect(sanitiseRunnerId(123 as any)).toBe(null)
    expect(sanitiseRunnerId('x'.repeat(100))?.length).toBe(64)
    expect(sanitiseCredentialId('a/b')).toBe(null)
  })
})

describe('substituteConfig', () => {
  test('replaces ${projectRoot} in strings and string arrays only', () => {
    const out = substituteConfig(
      { cliPath: '${projectRoot}/bin', flags: ['--cwd', '${projectRoot}'], n: 5 },
      { projectRoot: '/proj' },
    )
    expect(out).toEqual({ cliPath: '/proj/bin', flags: ['--cwd', '/proj'], n: 5 })
  })
})

describe('normalizeAgentRef', () => {
  test('rewrites dev-agent-teams: → repo:dev-agent-teams:', () => {
    expect(normalizeAgentRef('dev-agent-teams:investigator')).toBe('repo:dev-agent-teams:investigator')
    expect(normalizeAgentRef('user:foo')).toBe('user:foo')
    expect(normalizeAgentRef(42 as any)).toBe(42)
  })
})

describe('resolveSecretRef', () => {
  test('classifies secretRef kinds', () => {
    expect(resolveSecretRef({ secretRef: 'cli-session' } as any)).toEqual({ type: 'cli-session' })
    expect(resolveSecretRef({ secretRef: 'env:MY_KEY' } as any)).toMatchObject({ type: 'env', key: 'MY_KEY' })
    expect(resolveSecretRef({ secretRef: 'file:/x' } as any)).toEqual({ type: 'file', path: '/x' })
    expect(resolveSecretRef({} as any)).toEqual({ type: 'none' })
    expect(resolveSecretRef({ secretRef: 'weird' } as any)).toEqual({ type: 'unknown', ref: 'weird' })
  })
})

describe('runners registry CRUD', () => {
  test('default store has claude-code-local', () => {
    const store = loadRunners()
    expect(store.defaultRunnerId).toBe('claude-code-local')
    expect(store.runners[0].id).toBe('claude-code-local')
    expect(getDefaultRunner()?.id).toBe('claude-code-local')
  })
  test('upsert validates and persists', () => {
    expect(upsertRunner({ id: '' } as any)).toEqual({ ok: false, error: 'invalid runner id' })
    expect(upsertRunner({ id: 'r2' } as any)).toEqual({ ok: false, error: 'provider is required' })
    expect(upsertRunner({ id: 'r2', provider: 'p' } as any)).toEqual({ ok: false, error: 'credentialId is required' })
    const res = upsertRunner({ id: 'r2', provider: 'claude-code-cli', credentialId: 'claude-default' } as any)
    expect(res.ok).toBe(true)
    expect(getRunner('r2')?.id).toBe('r2')
    expect(listRunners().runners.length).toBe(2)
  })
  test('delete guards the last runner; setDefault validates', () => {
    expect(deleteRunner('claude-code-local')).toMatchObject({ ok: false, status: 400 })
    upsertRunner({ id: 'r2', provider: 'p', credentialId: 'claude-default' } as any)
    expect(deleteRunner('r2')).toEqual({ ok: true })
    expect(setDefaultRunner('ghost')).toMatchObject({ ok: false, status: 404 })
    upsertRunner({ id: 'r3', provider: 'p', credentialId: 'claude-default' } as any)
    expect(setDefaultRunner('r3')).toEqual({ ok: true, defaultRunnerId: 'r3' })
  })
})

describe('credentials CRUD', () => {
  test('default profile + upsert + delete-last guard', () => {
    expect(loadCredentials().profiles[0].id).toBe('claude-default')
    expect(getCredential('claude-default')?.provider).toBe('claude-code-cli')
    expect(upsertCredential({ id: 'c2' } as any)).toEqual({ ok: false, error: 'provider is required' })
    expect(upsertCredential({ id: 'c2', provider: 'p' } as any).ok).toBe(true)
    expect(listCredentials().length).toBe(2)
    expect(deleteCredential('claude-default')).toEqual({ ok: true })
    expect(deleteCredential('c2')).toMatchObject({ ok: false, status: 400 })
  })
})

describe('provider registry', () => {
  test('claude-code-cli provider is registered', () => {
    expect(listProviderIds()).toContain('claude-code-cli')
    const p = getProvider('claude-code-cli')
    expect(p?.providerId).toBe('claude-code-cli')
    expect(typeof p?.execute).toBe('function')
    expect(getProvider('nope')).toBe(null)
  })
})

describe('job queue', () => {
  test('loadJob(missing) → null, listJobs starts empty', () => {
    expect(loadJob('does-not-exist')).toBe(null)
    expect(listJobs()).toEqual([])
  })
  test('submitJob returns a queued job; cancel finished/missing handled', () => {
    const job = submitJob({ agentRef: 'noref', workspace: home })
    expect(job.status).toBe('queued')
    expect(job.runnerId).toBe('claude-code-local')
    expect(path.isAbsolute(job.workspace)).toBe(true)
    expect(loadJob(job.id)?.id).toBe(job.id)
    expect(cancelJob('does-not-exist')).toMatchObject({ ok: false, status: 404 })
  })
})
