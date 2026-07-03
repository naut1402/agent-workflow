import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createClaudeCodeSshProvider } from '../../../server/runners/providers/claude-code-ssh.js'
import type { CredentialProfile, ExecuteRequest, ResolvedAgent } from '../../../server/runners/types.js'

const fixtures = path.join(import.meta.dir, '../../fixtures/bin')
const sshStub = path.join(fixtures, 'ssh-stub.mjs')

let sshLog: string
let home: string

const agent: ResolvedAgent = {
  ref: 'test:agent',
  name: 'Test',
  description: '',
  systemPrompt: 'Be helpful',
  skills: [],
}

const credential: CredentialProfile = {
  id: 'ssh-key',
  provider: 'claude-code-ssh',
  label: 'SSH Key',
  secretRef: 'file:/tmp/key',
}

function makeReq(workspace: string): ExecuteRequest {
  return {
    jobId: 'job-1',
    resolvedAgent: agent,
    userPrompt: 'hello',
    workspace,
    metadata: {},
  }
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'ssh-prov-'))
  sshLog = path.join(home, 'ssh.log')
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  process.env.SSH_STUB_SCRIPT = sshStub
})

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true })
  delete process.env.SSH_STUB_SCRIPT
  delete process.env.SSH_STUB_LOG
})

describe('claude-code-ssh provider', () => {
  test('T44-01 validateRunnerConfig rejects missing host/user', () => {
    const provider = createClaudeCodeSshProvider()
    const result = provider.validateRunnerConfig({ port: 22 })
    expect(result.ok).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  test('T44-02 execute invokes stub ssh with expected argv', async () => {
    process.env.SSH_STUB_LOG = sshLog
    const provider = createClaudeCodeSshProvider()

    const runnerConfig = {
      host: 'dev-mac.internal',
      user: 'dev',
      port: 22,
      remoteCliPath: 'claude',
      connectTimeoutMs: 5000,
    }

    const result = await provider.execute(
      makeReq('/Users/dev/work/.dev-team-agent'),
      runnerConfig,
      credential,
    )

    expect(result.ok).toBe(true)
    const log = fs.readFileSync(sshLog, 'utf8')
    expect(log).toContain('/tmp/key')
    expect(log).toContain('dev@dev-mac.internal')
    expect(log).toContain('claude')
    expect(log).toContain('/Users/dev/work/.dev-team-agent')
  })

  test('T44-08 listProviderIds still includes claude-code-cli', async () => {
    const { listProviderIds } = await import('../../../server/runners/providerRegistry.js')
    const ids = listProviderIds()
    expect(ids).toContain('claude-code-cli')
    expect(ids).toContain('claude-code-ssh')
  })
})
