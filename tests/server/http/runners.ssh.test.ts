import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../server/http/app.js'
import { createRegistryContext } from '../../../server/registry.js'
import { upsertRunner } from '../../../server/runners/registry.js'
import { upsertCredential } from '../../../server/runners/credentials.js'

const fixtures = path.join(import.meta.dir, '../../fixtures/bin')
const sshStub = path.join(fixtures, 'ssh-stub.mjs')

let home: string

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'runners-ssh-http-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  process.env.SSH_STUB_SCRIPT = sshStub
  delete process.env.DEV_TEAM_API_TOKEN

  upsertCredential({
    id: 'ssh-cred',
    provider: 'claude-code-ssh',
    label: 'Key',
    secretRef: 'file:/tmp/key',
  })
  upsertRunner({
    id: 'ssh-runner',
    name: 'SSH',
    provider: 'claude-code-ssh',
    credentialId: 'ssh-cred',
    config: { host: 'dev.local', user: 'dev', port: 22 },
  })
})

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true })
  delete process.env.SSH_STUB_SCRIPT
})

async function request(method: string, url: string, body?: unknown) {
  const app = createApp(createRegistryContext())
  return app.request(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('POST /api/runners/:id/test-ssh', () => {
  test('T44-06 returns ok for valid ssh runner', async () => {
    const res = await request('POST', '/api/runners/ssh-runner/test-ssh')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(typeof data.latencyMs).toBe('number')
  })

  test('T44-06 returns 429 when rate limited', async () => {
    await request('POST', '/api/runners/ssh-runner/test-ssh')
    const res = await request('POST', '/api/runners/ssh-runner/test-ssh')
    expect(res.status).toBe(429)
  })

  test('returns 400 for non-ssh runner', async () => {
    upsertRunner({
      id: 'local',
      provider: 'claude-code-cli',
      credentialId: 'ssh-cred',
      config: { cliPath: 'claude' },
    })
    const res = await request('POST', '/api/runners/local/test-ssh')
    expect(res.status).toBe(400)
  })
})
