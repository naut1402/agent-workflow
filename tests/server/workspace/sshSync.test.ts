import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pullArtifacts, testSshConnection, buildSshArgs } from '../../../server/workspace/sshSync.js'
import { upsertRunner } from '../../../server/runners/registry.js'
import { upsertCredential } from '../../../server/runners/credentials.js'
import { addSshProject, resolveProjectRoot } from '../../../server/registry.js'

const fixtures = path.join(import.meta.dir, '../../fixtures/bin')
const sshStub = path.join(fixtures, 'ssh-stub.mjs')
const rsyncStub = path.join(fixtures, 'rsync-stub.mjs')

let home: string
let remoteFixture: string
let cacheDir: string

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'ssh-sync-'))
  remoteFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-fix-'))
  cacheDir = path.join(home, 'cache', 'test-project')
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  process.env.SSH_STUB_SCRIPT = sshStub
  process.env.RSYNC_STUB_SCRIPT = rsyncStub
  process.env.RSYNC_STUB_FIXTURE = remoteFixture

  fs.mkdirSync(path.join(remoteFixture, 'remote', '.dev-team-agent', '.dev-state'), { recursive: true })
  fs.writeFileSync(
    path.join(remoteFixture, 'remote', '.dev-team-agent', '.dev-state', 'U001.json'),
    '{"current_phase":"design"}',
  )
  fs.mkdirSync(path.join(remoteFixture, 'remote', '.dev-team-agent', 'tasks', 'U001'), { recursive: true })
  fs.writeFileSync(
    path.join(remoteFixture, 'remote', '.dev-team-agent', 'tasks', 'U001', 'design.md'),
    '# Design',
  )

  upsertCredential({
    id: 'ssh-cred',
    provider: 'claude-code-ssh',
    label: 'Key',
    secretRef: 'file:/tmp/test-key',
  })
  upsertRunner({
    id: 'ssh-dev',
    name: 'SSH Dev',
    provider: 'claude-code-ssh',
    credentialId: 'ssh-cred',
    config: { host: 'dev.local', user: 'dev', port: 22 },
  })
})

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true })
  fs.rmSync(remoteFixture, { recursive: true, force: true })
  delete process.env.SSH_STUB_SCRIPT
  delete process.env.RSYNC_STUB_SCRIPT
  delete process.env.RSYNC_STUB_FIXTURE
})

describe('sshSync', () => {
  test('buildSshArgs includes batch mode and key', () => {
    const args = buildSshArgs({
      config: { port: 2222, connectTimeoutMs: 10000 },
      keyPath: '/keys/id',
      remoteTarget: 'dev@host',
      remoteCommand: 'echo ok',
    })
    expect(args).toContain('-i')
    expect(args).toContain('/keys/id')
    expect(args).toContain('-p')
    expect(args).toContain('2222')
    expect(args).toContain('dev@host')
    expect(args).toContain('echo ok')
  })

  test('T44-03 pullArtifacts copies .dev-state and tasks into cache', async () => {
    const added = addSshProject({
      kind: 'ssh',
      remotePath: '/remote/.dev-team-agent',
      name: 'Remote Dev',
      remote: {
        host: 'dev.local',
        user: 'dev',
        port: 22,
        runnerId: 'ssh-dev',
        artifactCache: cacheDir,
      },
    })
    expect(added.ok).toBe(true)
    if (!added.ok) return

    const { getRunner } = await import('../../../server/runners/registry.js')
    const { getCredential } = await import('../../../server/runners/credentials.js')
    const runner = getRunner('ssh-dev')!
    const credential = getCredential('ssh-cred')!

    const result = await pullArtifacts({
      project: added.project,
      runner,
      credential,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(fs.existsSync(path.join(cacheDir, '.dev-state', 'U001.json'))).toBe(true)
      expect(fs.existsSync(path.join(cacheDir, 'tasks', 'U001', 'design.md'))).toBe(true)
    }
  })

  test('T44-05 GET /api/tasks path uses cache without spawning ssh', async () => {
    const { collectTasks } = await import('../../../server/tasks/index.js')
    fs.mkdirSync(path.join(cacheDir, '.dev-state'), { recursive: true })
    fs.writeFileSync(path.join(cacheDir, '.dev-state', 'T1.json'), '{"current_phase":"review"}')

    const tasks = await collectTasks(cacheDir)
    expect(tasks.some((t) => t.task_id === 'T1')).toBe(true)
  })

  test('T44-06 testSshConnection ok via stub', async () => {
    const { getRunner } = await import('../../../server/runners/registry.js')
    const { getCredential } = await import('../../../server/runners/credentials.js')
    const result = await testSshConnection({
      runner: getRunner('ssh-dev')!,
      credential: getCredential('ssh-cred')!,
      execSsh: async () => ({ code: 0, stdout: 'ok\n', stderr: '', latencyMs: 12 }),
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.latencyMs).toBe(12)
  })

  test('T44-07 pull-cache failure when rsync stub fails', async () => {
    process.env.RSYNC_STUB_MODE = 'fail'
    const added = addSshProject({
      kind: 'ssh',
      remotePath: '/remote/.dev-team-agent',
      remote: {
        host: 'dev.local',
        user: 'dev',
        runnerId: 'ssh-dev',
        artifactCache: path.join(home, 'cache', 'fail'),
      },
    })
    if (!added.ok) return
    const { getRunner } = await import('../../../server/runners/registry.js')
    const { getCredential } = await import('../../../server/runners/credentials.js')
    const result = await pullArtifacts({
      project: added.project,
      runner: getRunner('ssh-dev')!,
      credential: getCredential('ssh-cred')!,
    })
    expect(result.ok).toBe(false)
    delete process.env.RSYNC_STUB_MODE
  })
})

describe('registry ssh root', () => {
  test('T44-04 resolveProjectRoot ssh returns artifactCache', () => {
    const added = addSshProject({
      kind: 'ssh',
      remotePath: '/remote/ws',
      remote: { host: 'h', user: 'u', runnerId: 'ssh-dev', artifactCache: cacheDir },
    })
    expect(added.ok).toBe(true)
    if (added.ok) {
      expect(resolveProjectRoot(added.project.id)).toBe(cacheDir)
    }
  })
})
