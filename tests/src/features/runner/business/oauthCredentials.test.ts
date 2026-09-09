import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  completeFromCallback,
  completeFromPaste,
  ensureFreshOAuthToken,
  getOAuthStatus,
  startOAuth,
  _resetOAuthPendingForTest,
} from '../../../../../src/features/runner/business/oauthCredentials.js'
import { getCredential } from '../../../../../src/features/runner/business/credentials.js'
import { readSecret, storeSecret } from '../../../../../src/features/runner/business/secretVault.js'

const originalFetch = globalThis.fetch
const savedEnv = { ...process.env }
const PROVIDER = 'gemini-api'
const PREFIX = 'RUNNER_OAUTH_GEMINI_API'
const REDIRECT_URI = 'https://dash.test/api/credentials/oauth/callback'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

let home: string

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-oauth-credentials-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  process.env.DASHBOARD_SECRET_KEY = 'test-passphrase'
  process.env[`${PREFIX}_AUTHORIZE_URL`] = 'https://example.test/authorize'
  process.env[`${PREFIX}_TOKEN_URL`] = 'https://example.test/token'
  process.env[`${PREFIX}_CLIENT_ID`] = 'client-123'
  process.env[`${PREFIX}_SCOPE`] = 'scope-a'
})
afterAll(() => {
  process.env = { ...savedEnv }
  fs.rmSync(home, { recursive: true, force: true })
})
beforeEach(() => {
  _resetOAuthPendingForTest()
  for (const f of ['credentials.json', 'secret-vault.json']) fs.rmSync(path.join(home, f), { force: true })
})
afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('startOAuth', () => {
  test('fails for a provider with no configured OAuth client', () => {
    const result = startOAuth('openai-api', 'My OpenAI', REDIRECT_URI)
    expect(result).toEqual({ ok: false, error: 'oauth not configured for provider: openai-api' })
  })

  test('returns a state + authorizeUrl for a configured provider', () => {
    const result = startOAuth(PROVIDER, 'My Gemini', REDIRECT_URI)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(typeof result.state).toBe('string')
    expect(result.authorizeUrl).toContain('https://example.test/authorize')
    expect(result.authorizeUrl).toContain(`state=${result.state}`)
  })
})

describe('completeFromCallback', () => {
  test('unknown state fails without ever calling the token endpoint', async () => {
    let called = false
    globalThis.fetch = (async () => {
      called = true
      return jsonResponse({})
    }) as unknown as typeof fetch
    const result = await completeFromCallback('no-such-state', 'code-1')
    expect(result).toEqual({ ok: false, error: 'unknown or expired oauth state' })
    expect(called).toBe(false)
  })

  test('exchanges the code, stores the token in the vault, and creates a credential pointing at it', async () => {
    const start = startOAuth(PROVIDER, 'My Gemini', REDIRECT_URI)
    if (!start.ok) throw new Error('unreachable')

    globalThis.fetch = (async () => jsonResponse({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 })) as unknown as typeof fetch

    const result = await completeFromCallback(start.state, 'code-1')
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')

    const credential = getCredential(result.credentialId)
    expect(credential?.provider).toBe(PROVIDER)
    expect(credential?.label).toBe('My Gemini')
    expect(credential?.secretRef).toBe(`oauth:${result.credentialId}`)

    const vaultEntry = readSecret<{ accessToken: string; refreshToken: string }>(result.credentialId)
    expect(vaultEntry?.accessToken).toBe('at-1')
    expect(vaultEntry?.refreshToken).toBe('rt-1')

    expect(getOAuthStatus(start.state)).toEqual({ status: 'done', credentialId: result.credentialId, error: undefined })
  })

  test('a token-endpoint failure surfaces as an error status, not a thrown exception', async () => {
    const start = startOAuth(PROVIDER, '', REDIRECT_URI)
    if (!start.ok) throw new Error('unreachable')
    globalThis.fetch = (async () => jsonResponse({ error: 'invalid_grant', error_description: 'expired' }, 400)) as unknown as typeof fetch

    const result = await completeFromCallback(start.state, 'bad-code')
    expect(result).toEqual({ ok: false, error: 'expired' })
    expect(getOAuthStatus(start.state)).toMatchObject({ status: 'error' })
  })
})

describe('completeFromPaste', () => {
  test('extracts `code` from a pasted full callback URL', async () => {
    const start = startOAuth(PROVIDER, '', REDIRECT_URI)
    if (!start.ok) throw new Error('unreachable')
    let seenBody = ''
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      seenBody = String(init?.body || '')
      return jsonResponse({ access_token: 'at-2', expires_in: 3600 })
    }) as unknown as typeof fetch

    const pasted = `${REDIRECT_URI}?code=pasted-code-1&state=${start.state}`
    const result = await completeFromPaste(start.state, pasted)
    expect(result.ok).toBe(true)
    expect(new URLSearchParams(seenBody).get('code')).toBe('pasted-code-1')
  })

  test('treats a bare pasted string as the code itself', async () => {
    const start = startOAuth(PROVIDER, '', REDIRECT_URI)
    if (!start.ok) throw new Error('unreachable')
    let seenBody = ''
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      seenBody = String(init?.body || '')
      return jsonResponse({ access_token: 'at-3', expires_in: 3600 })
    }) as unknown as typeof fetch

    await completeFromPaste(start.state, '  bare-code-xyz  ')
    expect(new URLSearchParams(seenBody).get('code')).toBe('bare-code-xyz')
  })
})

describe('ensureFreshOAuthToken', () => {
  test('returns the stored access token as-is when far from expiry', async () => {
    storeSecret('vk-1', { accessToken: 'at-fresh', refreshToken: 'rt-1', expiresAt: new Date(Date.now() + 3600_000).toISOString() })
    let called = false
    globalThis.fetch = (async () => {
      called = true
      return jsonResponse({})
    }) as unknown as typeof fetch

    const result = await ensureFreshOAuthToken('vk-1', PROVIDER)
    expect(result).toEqual({ ok: true, value: 'at-fresh' })
    expect(called).toBe(false)
  })

  test('refreshes and persists a new token when within the refresh margin', async () => {
    storeSecret('vk-2', { accessToken: 'at-stale', refreshToken: 'rt-2', expiresAt: new Date(Date.now() + 1000).toISOString() })
    globalThis.fetch = (async () => jsonResponse({ access_token: 'at-refreshed', expires_in: 3600 })) as unknown as typeof fetch

    const result = await ensureFreshOAuthToken('vk-2', PROVIDER)
    expect(result).toEqual({ ok: true, value: 'at-refreshed' })
    expect(readSecret<{ accessToken: string }>('vk-2')?.accessToken).toBe('at-refreshed')
  })

  test('fails clearly when the token is expired and there is no refresh token', async () => {
    storeSecret('vk-3', { accessToken: 'at-stale', refreshToken: null, expiresAt: new Date(Date.now() - 1000).toISOString() })
    const result = await ensureFreshOAuthToken('vk-3', PROVIDER)
    expect(result).toEqual({ ok: false, error: expect.stringContaining('connect again') })
  })

  test('fails clearly when the vault entry is missing (deleted/never existed)', async () => {
    const result = await ensureFreshOAuthToken('does-not-exist', PROVIDER)
    expect(result.ok).toBe(false)
  })
})
