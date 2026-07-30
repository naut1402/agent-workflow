import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  sanitiseRunnerId,
  sanitiseCredentialId,
  sanitiseConnectionId,
  DEFAULT_CONNECTION_ID,
} from '../../../server/runners/types.js'
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
  loadConnections,
  listConnections,
  getConnection,
  upsertConnection,
  deleteConnection,
  ensureLegacyConnection,
  listProviderCatalog,
  scanLocalCommands,
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
  for (const f of ['runners.json', 'credentials.json', 'connections.json']) {
    fs.rmSync(path.join(home, f), { force: true })
  }
})

describe('loadRunners', () => {
  test('strips UTF-8 BOM so PowerShell-saved runners.json still loads', () => {
    const payload = {
      version: 2,
      defaultRunnerId: 'claude-code-local',
      runners: [
        {
          id: 'claude-code-local',
          name: 'Claude Code CLI (local)',
          connectionId: 'claude-code-cli-local',
          enabled: true,
          config: {},
        },
      ],
    }
    const bom = Buffer.from([0xef, 0xbb, 0xbf])
    const body = Buffer.from(JSON.stringify(payload), 'utf8')
    fs.writeFileSync(path.join(home, 'runners.json'), Buffer.concat([bom, body]))
    const store = loadRunners()
    expect(store.runners).toHaveLength(1)
    expect(store.defaultRunnerId).toBe('claude-code-local')
  })
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
    expect(sanitiseConnectionId('ok-id')).toBe('ok-id')
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

describe('connections CRUD', () => {
  test('default store has claude-code-cli-local', () => {
    const store = loadConnections()
    expect(store.connections[0].id).toBe(DEFAULT_CONNECTION_ID)
    expect(getConnection(DEFAULT_CONNECTION_ID)?.kind).toBe('local-console')
  })
  test('upsert validates local-console and ai-provider', () => {
    expect(upsertConnection({ id: '' } as any)).toEqual({ ok: false, error: 'invalid connection id' })
    expect(upsertConnection({ id: 'c1', kind: 'local-console', providerId: 'cursor-cli' } as any)).toEqual({
      ok: false,
      error: 'cliPath is required for local-console',
    })
    expect(
      upsertConnection({ id: 'c1', kind: 'ai-provider', providerId: 'anthropic-api' } as any),
    ).toEqual({ ok: false, error: 'credentialId is required for ai-provider' })
    const res = upsertConnection({
      id: 'cursor-local',
      kind: 'local-console',
      providerId: 'cursor-cli',
      cliPath: 'agent',
      label: 'Cursor',
    })
    expect(res.ok).toBe(true)
    expect(listConnections().length).toBe(2)
  })
  test('delete guards the last connection', () => {
    expect(deleteConnection(DEFAULT_CONNECTION_ID)).toMatchObject({ ok: false, status: 400 })
    upsertConnection({
      id: 'extra',
      kind: 'local-console',
      providerId: 'codex-cli',
      cliPath: 'codex',
    })
    expect(deleteConnection('extra')).toEqual({ ok: true })
  })
  test('ensureLegacyConnection creates or reuses', () => {
    const id = ensureLegacyConnection({
      provider: 'claude-code-cli',
      credentialId: 'claude-default',
      cliPath: 'claude',
    })
    expect(id).toBe(DEFAULT_CONNECTION_ID)
    const other = ensureLegacyConnection({ provider: 'cursor-cli', cliPath: 'agent' })
    expect(other).toBe('cursor-cli-migrated')
    expect(getConnection(other)?.providerId).toBe('cursor-cli')
    expect(getConnection(other)?.cliPath).toBe('agent')
  })
  test('scanLocalCommands returns Cursor CLI as agent', () => {
    const cmds = scanLocalCommands()
    expect(cmds.length).toBe(3)
    const cursor = cmds.find((c) => c.id === 'cursor')
    expect(cursor).toMatchObject({ command: 'agent', providerId: 'cursor-cli' })
    for (const c of cmds) {
      expect(c).toMatchObject({
        id: expect.any(String),
        command: expect.any(String),
        available: expect.any(Boolean),
        providerId: expect.any(String),
      })
      expect('path' in c).toBe(true)
    }
  })
  test('provider catalog includes kind metadata', () => {
    const catalog = listProviderCatalog()
    expect(catalog.find((p) => p.id === 'claude-code-cli')?.kind).toBe('local-console')
    expect(catalog.find((p) => p.id === 'console-command')?.kind).toBe('local-console')
    expect(catalog.find((p) => p.id === 'anthropic-api')?.kind).toBe('ai-provider')
  })
})

describe('runners registry CRUD', () => {
  test('empty store when no runners.json (no forced seed)', () => {
    const store = loadRunners()
    expect(store.runners).toEqual([])
    expect(store.defaultRunnerId).toBe(null)
    expect(getDefaultRunner()).toBe(null)
  })
  test('upsert validates and persists connectionId', () => {
    expect(upsertRunner({ id: '' } as any)).toEqual({ ok: false, error: 'invalid runner id' })
    expect(upsertRunner({ id: 'r2' } as any)).toEqual({ ok: false, error: 'connectionId is required' })
    const res = upsertRunner({ id: 'r2', connectionId: DEFAULT_CONNECTION_ID } as any)
    expect(res.ok).toBe(true)
    expect(getRunner('r2')?.connectionId).toBe(DEFAULT_CONNECTION_ID)
    expect(listRunners().runners.length).toBe(1)
  })
  test('legacy provider+credentialId migrates to connectionId', () => {
    const res = upsertRunner({
      id: 'legacy-r',
      provider: 'claude-code-cli',
      credentialId: 'claude-default',
      config: { cliPath: 'claude', timeoutMs: 1000 },
    } as any)
    expect(res.ok).toBe(true)
    expect(getRunner('legacy-r')?.connectionId).toBe(DEFAULT_CONNECTION_ID)
    expect(getRunner('legacy-r')?.config).not.toHaveProperty('cliPath')
  })
  test('loadRunners migrates on-disk v1 runners.json', () => {
    fs.writeFileSync(
      path.join(home, 'runners.json'),
      JSON.stringify({
        version: 1,
        defaultRunnerId: 'old',
        runners: [
          {
            id: 'old',
            name: 'Old',
            provider: 'claude-code-cli',
            credentialId: 'claude-default',
            config: { cliPath: 'claude', flags: ['--print'] },
          },
        ],
      }),
      'utf8',
    )
    const store = loadRunners()
    expect(store.runners[0].connectionId).toBe(DEFAULT_CONNECTION_ID)
    expect(store.runners[0].config).not.toHaveProperty('cliPath')
  })
  test('empty runners.json [] is preserved (not re-seeded)', () => {
    fs.writeFileSync(
      path.join(home, 'runners.json'),
      JSON.stringify({ version: 2, defaultRunnerId: null, runners: [] }),
      'utf8',
    )
    expect(loadRunners().runners).toEqual([])
  })
  test('can delete last runner; setDefault validates', () => {
    upsertRunner({ id: 'r1', connectionId: DEFAULT_CONNECTION_ID } as any)
    expect(deleteRunner('r1')).toEqual({ ok: true })
    expect(listRunners().runners).toEqual([])
    expect(listRunners().defaultRunnerId).toBe(null)
    expect(deleteRunner('ghost')).toMatchObject({ ok: false, status: 404 })
    upsertRunner({ id: 'r3', connectionId: DEFAULT_CONNECTION_ID } as any)
    expect(setDefaultRunner('ghost')).toMatchObject({ ok: false, status: 404 })
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
  test('local-console providers are registered', () => {
    expect(listProviderIds()).toContain('claude-code-cli')
    expect(listProviderIds()).toContain('cursor-cli')
    expect(listProviderIds()).toContain('codex-cli')
    expect(listProviderIds()).toContain('console-command')
    const p = getProvider('claude-code-cli')
    expect(p?.providerId).toBe('claude-code-cli')
    expect(typeof p?.execute).toBe('function')
    expect(getProvider('console-command')?.capabilities().supportsAgentFile).toBe(false)
    expect(getProvider('nope')).toBe(null)
  })
})

describe('job queue', () => {
  test('loadJob(missing) → null, listJobs starts empty', () => {
    expect(loadJob('does-not-exist')).toBe(null)
    expect(listJobs()).toEqual([])
  })
  test('submitJob returns a queued job; cancel finished/missing handled', () => {
    upsertRunner({ id: 'claude-code-local', connectionId: DEFAULT_CONNECTION_ID } as any)
    const job = submitJob({ agentRef: 'noref', workspace: home })
    expect(job.status).toBe('queued')
    expect(job.runnerId).toBe('claude-code-local')
    expect(path.isAbsolute(job.workspace)).toBe(true)
    expect(loadJob(job.id)?.id).toBe(job.id)
    expect(cancelJob('does-not-exist')).toMatchObject({ ok: false, status: 404 })
  })
})
