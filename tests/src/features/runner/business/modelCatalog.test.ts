import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { listAvailableModels } from '../../../../../src/features/runner/business/modelCatalog.js'
import { upsertCredential } from '../../../../../src/features/runner/business/credentials.js'

const originalFetch = globalThis.fetch

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

let home: string
const savedEnv = { ...process.env }

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-model-catalog-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  process.env.DASHBOARD_SECRET_KEY = 'test-passphrase'
  process.env.FAKE_MODEL_CATALOG_KEY = 'sk-env-test'
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
})
beforeEach(() => {
  for (const f of ['credentials.json', 'secret-vault.json']) {
    fs.rmSync(path.join(home, f), { force: true })
  }
})
afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('listAvailableModels', () => {
  test('claude-code-cli returns the static alias list without any credential/network call', async () => {
    let called = false
    globalThis.fetch = (async () => {
      called = true
      return jsonResponse({ data: [] })
    }) as unknown as typeof fetch

    const result = await listAvailableModels({ providerId: 'claude-code-cli' })
    expect(result).toEqual({ ok: true, models: ['opus', 'sonnet', 'haiku'] })
    expect(called).toBe(false)
  })

  test('a CLI provider other than claude-code-cli (e.g. cursor-cli) is still rejected with a clear error', async () => {
    const result = await listAvailableModels({ providerId: 'cursor-cli', secretValue: 'whatever' })
    expect(result).toEqual({ ok: false, error: 'provider này không hỗ trợ liệt kê model' })
  })

  test('an unknown providerId is rejected with a clear error', async () => {
    const result = await listAvailableModels({ providerId: 'does-not-exist', secretValue: 'whatever' })
    expect(result.ok).toBe(false)
  })

  test('neither credentialId nor secretValue given fails fast without any network call', async () => {
    let called = false
    globalThis.fetch = (async () => {
      called = true
      return jsonResponse({ data: [] })
    }) as unknown as typeof fetch

    const result = await listAvailableModels({ providerId: 'openai-api' })
    expect(result).toEqual({ ok: false, error: 'chọn credential hoặc nhập secret trước khi tải model' })
    expect(called).toBe(false)
  })

  test('a raw, not-yet-saved secretValue (mid "+ Credential" flow) is used directly', async () => {
    let seenAuth = ''
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      seenAuth = new Headers(init?.headers).get('authorization') || ''
      return jsonResponse({ data: [{ id: 'gpt-4.1' }] })
    }) as unknown as typeof fetch

    const result = await listAvailableModels({ providerId: 'openai-api', secretValue: 'sk-unsaved-secret' })
    expect(result).toEqual({ ok: true, models: ['gpt-4.1'] })
    expect(seenAuth).toBe('Bearer sk-unsaved-secret')
  })

  test('an existing credentialId is resolved server-side and used', async () => {
    const saved = upsertCredential({ provider: 'openai-api', secretRef: 'env:FAKE_MODEL_CATALOG_KEY' } as any)
    if (!saved.ok) throw new Error('setup failed')

    let seenAuth = ''
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      seenAuth = new Headers(init?.headers).get('authorization') || ''
      return jsonResponse({ data: [{ id: 'gpt-4o' }] })
    }) as unknown as typeof fetch

    const result = await listAvailableModels({ providerId: 'openai-api', credentialId: saved.profile.id })
    expect(result).toEqual({ ok: true, models: ['gpt-4o'] })
    expect(seenAuth).toBe('Bearer sk-env-test')
  })

  test('a credentialId that resolves to no usable secret fails with a clear error, no network call', async () => {
    const saved = upsertCredential({ provider: 'openai-api', secretRef: 'cli-session' } as any)
    if (!saved.ok) throw new Error('setup failed')

    let called = false
    globalThis.fetch = (async () => {
      called = true
      return jsonResponse({ data: [] })
    }) as unknown as typeof fetch

    const result = await listAvailableModels({ providerId: 'openai-api', credentialId: saved.profile.id })
    expect(result.ok).toBe(false)
    expect(called).toBe(false)
  })

  test('the provider throwing (network error / unsupported gateway) surfaces as a clean error, not a crash', async () => {
    globalThis.fetch = (async () => jsonResponse({ error: { message: 'not found' } }, 404)) as unknown as typeof fetch

    const result = await listAvailableModels({ providerId: 'openai-api', secretValue: 'sk-x' })
    expect(result.ok).toBe(false)
  })
})
