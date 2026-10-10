import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  sanitiseRunnerId,
  sanitiseCredentialId,
  sanitiseConnectionId,
  DEFAULT_CONNECTION_ID,
} from '../../../../src/features/runner/business/types.js'
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
  upsertCustomCommand,
  deleteCustomCommand,
  listCustomCommands,
  listProviderIds,
  getProvider,
  submitJob,
  loadJob,
  listJobs,
  cancelJob,
} from '../../../../src/features/runner/business/index.js'
import { on, _resetEventBusForTest } from '../../../../src/backend/events/index.js'
import { readSecret, storeSecret } from '../../../../src/features/runner/business/secretVault.js'

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
  process.env.DASHBOARD_SECRET_KEY = 'test-passphrase'
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
})
beforeEach(() => {
  for (const f of ['runners.json', 'credentials.json', 'connections.json', 'secret-vault.json']) {
    fs.rmSync(path.join(home, f), { force: true })
  }
  _resetEventBusForTest()
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

  test('stored: reads the pasted secret value out of the vault', () => {
    storeSecret('vault-1', { value: 'pasted-value' })
    expect(resolveSecretRef({ secretRef: 'stored:vault-1' } as any)).toEqual({ type: 'stored', value: 'pasted-value' })
    expect(resolveSecretRef({ secretRef: 'stored:missing' } as any)).toEqual({ type: 'stored', value: null })
  })

  test('oauth: reads the access token (and expiresAt) out of the vault', () => {
    storeSecret('vault-2', { accessToken: 'at-1', expiresAt: '2030-01-01T00:00:00.000Z' })
    expect(resolveSecretRef({ secretRef: 'oauth:vault-2' } as any)).toEqual({
      type: 'oauth',
      value: 'at-1',
      expiresAt: '2030-01-01T00:00:00.000Z',
    })
    expect(resolveSecretRef({ secretRef: 'oauth:missing' } as any)).toEqual({ type: 'oauth', value: null, expiresAt: null })
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
    expect(cmds.filter((c) => !c.custom).length).toBe(3)
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
  test('custom commands CRUD + appear in scan', () => {
    expect(upsertCustomCommand({ id: '', path: '/bin/foo' } as any)).toEqual({
      ok: false,
      error: 'invalid command (id and path required)',
    })
    expect(upsertCustomCommand({ id: 'my-tool', path: '' } as any)).toEqual({
      ok: false,
      error: 'invalid command (id and path required)',
    })
    const res = upsertCustomCommand({
      id: 'my-tool',
      command: 'foo',
      path: 'C:\\tools\\foo.exe',
      providerId: 'console-command',
      flags: ['--json'],
    })
    expect(res.ok).toBe(true)
    expect(listCustomCommands()).toHaveLength(1)
    expect(listCustomCommands()[0]).toMatchObject({
      id: 'my-tool',
      command: 'foo',
      path: 'C:\\tools\\foo.exe',
      flags: ['--json'],
    })
    const scanned = scanLocalCommands()
    expect(scanned.find((c) => c.id === 'my-tool')).toMatchObject({
      custom: true,
      path: 'C:\\tools\\foo.exe',
      providerId: 'console-command',
    })
    expect(upsertCustomCommand({
      id: 'my-tool',
      command: 'foo2',
      path: '/usr/bin/foo',
      providerId: 'console-command',
    }).ok).toBe(true)
    expect(listCustomCommands()[0].command).toBe('foo2')
    expect(deleteCustomCommand('my-tool')).toEqual({ ok: true })
    expect(listCustomCommands()).toHaveLength(0)
    expect(deleteCustomCommand('missing')).toMatchObject({ ok: false, status: 404 })
  })
  test('provider catalog includes kind metadata', () => {
    const catalog = listProviderCatalog()
    expect(catalog.find((p) => p.id === 'claude-code-cli')?.kind).toBe('local-console')
    expect(catalog.find((p) => p.id === 'console-command')?.kind).toBe('local-console')
    expect(catalog.find((p) => p.id === 'anthropic-api')?.kind).toBe('ai-provider')
  })
  test('provider catalog includes the API-based agentic providers, all family ai-api', () => {
    const catalog = listProviderCatalog()
    for (const id of ['openai-api', 'gemini-api', 'xai-api', 'anthropic-api']) {
      const entry = catalog.find((p) => p.id === id)
      expect(entry?.kind).toBe('ai-provider')
      expect(entry?.family).toBe('ai-api')
    }
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

  test('omitting id mints a fresh one instead of failing (the "+ Credential" form no longer asks for it)', () => {
    const result = upsertCredential({ provider: 'openai-api', label: 'My key' } as any)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(typeof result.profile.id).toBe('string')
    expect(result.profile.id.length).toBeGreaterThan(0)
    expect(getCredential(result.profile.id)?.label).toBe('My key')
  })

  test('secretValue is stored encrypted, not persisted as-is; secretRef points at the vault entry', () => {
    const result = upsertCredential({ id: 'c-pasted', provider: 'openai-api', secretValue: 'sk-real-secret' } as any)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.profile.secretRef).toBe('stored:c-pasted')

    const raw = fs.readFileSync(path.join(home, 'credentials.json'), 'utf8')
    expect(raw).not.toContain('sk-real-secret')
    expect(readSecret<{ value: string }>('c-pasted')).toEqual({ value: 'sk-real-secret' })
  })

  test('deleting a credential with a stored: secretRef also removes the vault entry', () => {
    upsertCredential({ id: 'c-del', provider: 'openai-api', secretValue: 'sk-to-delete' } as any)
    expect(deleteCredential('c-del')).toEqual({ ok: true })
    expect(readSecret('c-del')).toBeNull()
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
  test('the 4 API-based agentic providers are registered and share the AgenticApiProvider capabilities contract', () => {
    for (const id of ['openai-api', 'gemini-api', 'xai-api', 'anthropic-api']) {
      expect(listProviderIds()).toContain(id)
      const p = getProvider(id)
      expect(p?.providerId).toBe(id)
      expect(typeof p?.execute).toBe('function')
      expect(p?.capabilities()).toEqual({ supportsAgentFile: false, supportsStreaming: false, maxConcurrency: 1 })
    }
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

  test('submitJob emits job.queued', () => {
    upsertRunner({ id: 'claude-code-local', connectionId: DEFAULT_CONNECTION_ID } as any)
    const seen: string[] = []
    on('job.queued', (e) => {
      seen.push(String(e.payload.jobId))
    })
    const job = submitJob({ agentRef: 'noref', workspace: home })
    expect(seen).toEqual([job.id])
  })

  test('cancelJob emits job.cancelled after status cancelled', () => {
    upsertRunner({ id: 'claude-code-local', connectionId: DEFAULT_CONNECTION_ID } as any)
    const job = submitJob({ agentRef: 'noref', workspace: home })
    const events: Array<Record<string, unknown>> = []
    on('job.cancelled', (e) => {
      events.push(e.payload)
      expect(loadJob(job.id)?.status).toBe('cancelled')
    })
    expect(cancelJob(job.id)).toMatchObject({ ok: true })
    expect(events).toEqual([{ jobId: job.id, taskId: undefined, projectId: undefined }])
  })

  test('cancelJob on already-cancelled is idempotent (no second emit)', () => {
    upsertRunner({ id: 'claude-code-local', connectionId: DEFAULT_CONNECTION_ID } as any)
    const job = submitJob({ agentRef: 'noref', workspace: home })
    expect(cancelJob(job.id)).toMatchObject({ ok: true })
    const events: Array<Record<string, unknown>> = []
    on('job.cancelled', (e) => {
      events.push(e.payload)
    })
    expect(cancelJob(job.id)).toMatchObject({ ok: true })
    expect(events).toEqual([])
  })

  test('early-fail missing runner emits job.failed without job.started', async () => {
    const types: string[] = []
    on('*', (e) => {
      types.push(e.type)
    })
    const job = submitJob({ agentRef: 'noref', workspace: home, runnerId: 'missing-runner' })
    expect(types).toContain('job.queued')
    for (let i = 0; i < 40; i++) {
      const cur = loadJob(job.id)
      if (cur?.status === 'failed') break
      await new Promise((r) => setTimeout(r, 25))
    }
    expect(loadJob(job.id)?.status).toBe('failed')
    expect(types).toContain('job.failed')
    expect(types).not.toContain('job.started')
  })
})

// T6fabee9b · nhóm B của test-spec — cờ `create` chặn ghi đè bản ghi trùng id.
//
// Root cause số 1 của bug: id connection/runner suy từ `slugify(nhãn)`, nên hai
// lần "Thêm mới" cùng tên sinh cùng id và lần sau thay chỗ lần trước **trong im
// lặng**. Với connection thì nó đổi luôn `providerId`/`config.model`/
// `credentialId` — tức đổi hẳn model mà runner mặc định thật sự chạy.
//
// `create` là cờ OPT-IN: chỉ dialog tạo mới của FE gửi, nên caller lập trình
// (test cũ, migration, `ensureLegacyConnection`) giữ nguyên hành vi upsert.
// Cặp TC-D09 / TC-D11 là hợp đồng bảo vệ đúng điều đó.
describe('create flag — 409 khi tạo mới trùng id', () => {
  function seedOtherConnection() {
    upsertConnection({
      id: 'conn-khac',
      kind: 'local-console',
      providerId: 'cursor-cli',
      cliPath: 'agent',
    })
  }

  test('TC-D08: upsertRunner create:true trên id đã tồn tại ⇒ 409, bản ghi cũ nguyên vẹn', () => {
    seedOtherConnection()
    upsertRunner({
      id: 'x',
      name: 'Bản gốc',
      connectionId: DEFAULT_CONNECTION_ID,
      enabled: true,
      maxConcurrency: 3,
      config: { timeoutMs: 1000 },
    } as any)

    const res = upsertRunner({
      id: 'x',
      name: 'Bản đè',
      connectionId: 'conn-khac',
      enabled: false,
      maxConcurrency: 9,
      config: { timeoutMs: 7777 },
      create: true,
    } as any)

    expect(res.ok).toBe(false)
    if (!('error' in res)) throw new Error('unreachable')
    expect(res.status).toBe(409)
    expect(res.error).toContain('x')
    expect(res.error).toContain('đã tồn tại')

    const kept = getRunner('x')!
    expect(kept.name).toBe('Bản gốc')
    expect(kept.connectionId).toBe(DEFAULT_CONNECTION_ID)
    expect(kept.enabled).toBe(true)
    expect(kept.maxConcurrency).toBe(3)
    expect(kept.config).toEqual({ timeoutMs: 1000 })
  })

  test('TC-D09: KHÔNG có cờ create ⇒ upsert-merge như cũ (hợp đồng của caller lập trình)', () => {
    upsertRunner({ id: 'x', name: 'Bản gốc', connectionId: DEFAULT_CONNECTION_ID } as any)

    const res = upsertRunner({ id: 'x', name: 'Bản mới', connectionId: DEFAULT_CONNECTION_ID } as any)

    expect(res.ok).toBe(true)
    expect(getRunner('x')?.name).toBe('Bản mới')
    expect(listRunners().runners).toHaveLength(1)
  })

  test('TC-D10: upsertConnection create:true trên id đã tồn tại ⇒ 409, model/credential cũ KHÔNG đổi', () => {
    upsertConnection({
      id: 'claude-api',
      label: 'claude',
      kind: 'ai-provider',
      providerId: 'anthropic-api',
      credentialId: 'claude-default',
      config: { model: 'claude-cu', baseURL: 'https://cu.example/v1' },
    } as any)

    const res = upsertConnection({
      id: 'claude-api',
      label: 'Claude',
      kind: 'ai-provider',
      providerId: 'openai-api',
      credentialId: 'cred-khac',
      config: { model: 'gpt-moi', baseURL: 'https://moi.example/v1' },
      create: true,
    } as any)

    expect(res.ok).toBe(false)
    if (!('error' in res)) throw new Error('unreachable')
    expect(res.status).toBe(409)
    expect(res.error).toContain('claude-api')

    // `model` sống trong connection — đây là thứ quyết định job chạy bằng gì.
    const kept = getConnection('claude-api')!
    expect(kept.providerId).toBe('anthropic-api')
    expect(kept.credentialId).toBe('claude-default')
    expect(kept.config).toEqual({ model: 'claude-cu', baseURL: 'https://cu.example/v1' })
  })

  test('TC-D11: upsertConnection KHÔNG có cờ create ⇒ replace như cũ (bảo vệ ensureLegacyConnection)', () => {
    upsertConnection({
      id: 'c',
      kind: 'local-console',
      providerId: 'cursor-cli',
      cliPath: 'agent',
    } as any)

    const res = upsertConnection({
      id: 'c',
      kind: 'local-console',
      providerId: 'codex-cli',
      cliPath: 'codex',
    } as any)

    expect(res.ok).toBe(true)
    expect(getConnection('c')?.providerId).toBe('codex-cli')
  })

  test('TC-D24: create:true với id CHƯA tồn tại ⇒ tạo được bình thường', () => {
    const conn = upsertConnection({
      id: 'conn-moi',
      kind: 'local-console',
      providerId: 'cursor-cli',
      cliPath: 'agent',
      create: true,
    } as any)
    expect(conn.ok).toBe(true)

    const runner = upsertRunner({ id: 'r-moi', connectionId: 'conn-moi', create: true } as any)
    expect(runner.ok).toBe(true)
    expect(getRunner('r-moi')?.connectionId).toBe('conn-moi')
  })

  test('TC-D25: cờ create 🚫 không lọt vào bản ghi persist trên đĩa', () => {
    upsertConnection({
      id: 'conn-persist',
      kind: 'local-console',
      providerId: 'cursor-cli',
      cliPath: 'agent',
      create: true,
    } as any)
    upsertRunner({ id: 'r-persist', connectionId: 'conn-persist', create: true } as any)

    const runnersRaw = JSON.parse(fs.readFileSync(path.join(home, 'runners.json'), 'utf8'))
    const connRaw = JSON.parse(fs.readFileSync(path.join(home, 'connections.json'), 'utf8'))
    expect(runnersRaw.runners.find((r: any) => r.id === 'r-persist')).not.toHaveProperty('create')
    expect(connRaw.connections.find((c: any) => c.id === 'conn-persist')).not.toHaveProperty('create')
  })

  test('TC-D26: 409 🚫 không để lại tác dụng phụ nào — số runner và default giữ nguyên', () => {
    upsertRunner({ id: 'x', connectionId: DEFAULT_CONNECTION_ID } as any)
    expect(setDefaultRunner('x')).toEqual({ ok: true, defaultRunnerId: 'x' })
    const before = listRunners()

    expect(upsertRunner({ id: 'x', connectionId: DEFAULT_CONNECTION_ID, create: true } as any)).toMatchObject({
      ok: false,
      status: 409,
    })

    const after = listRunners()
    expect(after.runners).toHaveLength(before.runners.length)
    expect(after.defaultRunnerId).toBe('x')
  })

  test('TC-D26b: payload legacy mang create 🚫 không kịp tạo connection trước khi 409', () => {
    // `ensureLegacyConnection` ghi đĩa, nên guard đặt sau nó sẽ để lại một
    // connection mới rồi mới từ chối. Số connection là thứ quan sát được.
    upsertRunner({ id: 'legacy-x', connectionId: DEFAULT_CONNECTION_ID } as any)
    const before = listConnections().length

    expect(
      upsertRunner({
        id: 'legacy-x',
        provider: 'cursor-cli',
        config: { cliPath: 'agent' },
        create: true,
      } as any),
    ).toMatchObject({ ok: false, status: 409 })

    expect(listConnections()).toHaveLength(before)
  })
})
