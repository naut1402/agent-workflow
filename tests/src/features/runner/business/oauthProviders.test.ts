import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  buildAuthorizeUrl,
  exchangeCode,
  getOAuthConfig,
  isOAuthCapable,
  refreshAccessToken,
} from '../../../../../src/features/runner/business/oauthProviders.js'

const originalFetch = globalThis.fetch
const savedEnv = { ...process.env }
const PROVIDER = 'gemini-api'
const PREFIX = 'RUNNER_OAUTH_GEMINI_API'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function clearProviderEnv() {
  for (const suffix of ['AUTHORIZE_URL', 'TOKEN_URL', 'CLIENT_ID', 'CLIENT_SECRET', 'SCOPE']) {
    delete process.env[`${PREFIX}_${suffix}`]
  }
}

beforeEach(() => {
  clearProviderEnv()
})
afterEach(() => {
  process.env = { ...savedEnv }
  globalThis.fetch = originalFetch
})

function setFullConfig() {
  process.env[`${PREFIX}_AUTHORIZE_URL`] = 'https://example.test/authorize'
  process.env[`${PREFIX}_TOKEN_URL`] = 'https://example.test/token'
  process.env[`${PREFIX}_CLIENT_ID`] = 'client-123'
  process.env[`${PREFIX}_SCOPE`] = 'scope-a scope-b'
}

describe('getOAuthConfig / isOAuthCapable', () => {
  test('null when no env vars are set for the provider', () => {
    expect(getOAuthConfig(PROVIDER)).toBeNull()
    expect(isOAuthCapable(PROVIDER)).toBe(false)
  })

  test('null when only some of the required vars are set (partial config never half-enables OAuth)', () => {
    process.env[`${PREFIX}_AUTHORIZE_URL`] = 'https://example.test/authorize'
    process.env[`${PREFIX}_CLIENT_ID`] = 'client-123'
    expect(getOAuthConfig(PROVIDER)).toBeNull()
  })

  test('full config resolves, client secret stays optional', () => {
    setFullConfig()
    expect(getOAuthConfig(PROVIDER)).toEqual({
      authorizeUrl: 'https://example.test/authorize',
      tokenUrl: 'https://example.test/token',
      clientId: 'client-123',
      clientSecret: undefined,
      scope: 'scope-a scope-b',
    })
    expect(isOAuthCapable(PROVIDER)).toBe(true)
  })

  test('a provider with no configured id is unaffected by another provider being configured', () => {
    setFullConfig()
    expect(isOAuthCapable('openai-api')).toBe(false)
  })
})

describe('buildAuthorizeUrl', () => {
  test('includes PKCE + state params, response_type=code', () => {
    setFullConfig()
    const config = getOAuthConfig(PROVIDER)!
    const url = new URL(
      buildAuthorizeUrl(config, { redirectUri: 'https://dash.test/api/credentials/oauth/callback', state: 'st-1', codeChallenge: 'chal-1' }),
    )
    expect(url.origin + url.pathname).toBe('https://example.test/authorize')
    expect(url.searchParams.get('client_id')).toBe('client-123')
    expect(url.searchParams.get('redirect_uri')).toBe('https://dash.test/api/credentials/oauth/callback')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')).toBe('scope-a scope-b')
    expect(url.searchParams.get('state')).toBe('st-1')
    expect(url.searchParams.get('code_challenge')).toBe('chal-1')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })
})

describe('exchangeCode / refreshAccessToken', () => {
  test('exchangeCode posts the PKCE verifier and maps the token response', async () => {
    setFullConfig()
    const config = getOAuthConfig(PROVIDER)!
    let seenBody = ''
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      seenBody = String(init?.body || '')
      return jsonResponse({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 })
    }) as unknown as typeof fetch

    const token = await exchangeCode(config, { code: 'code-1', redirectUri: 'https://dash.test/cb', codeVerifier: 'verifier-1' })
    expect(token.accessToken).toBe('at-1')
    expect(token.refreshToken).toBe('rt-1')
    expect(token.expiresAt).not.toBeNull()
    expect(new URLSearchParams(seenBody).get('grant_type')).toBe('authorization_code')
    expect(new URLSearchParams(seenBody).get('code_verifier')).toBe('verifier-1')
  })

  test('exchangeCode surfaces the provider error_description instead of a generic failure', async () => {
    setFullConfig()
    const config = getOAuthConfig(PROVIDER)!
    globalThis.fetch = (async () => jsonResponse({ error: 'invalid_grant', error_description: 'code expired' }, 400)) as unknown as typeof fetch

    await expect(exchangeCode(config, { code: 'bad', redirectUri: 'r', codeVerifier: 'v' })).rejects.toThrow(/code expired/)
  })

  test('refreshAccessToken posts grant_type=refresh_token and reuses the refresh token when the response omits one', async () => {
    setFullConfig()
    const config = getOAuthConfig(PROVIDER)!
    let seenBody = ''
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      seenBody = String(init?.body || '')
      return jsonResponse({ access_token: 'at-2', expires_in: 60 })
    }) as unknown as typeof fetch

    const token = await refreshAccessToken(config, 'rt-1')
    expect(token.accessToken).toBe('at-2')
    expect(token.refreshToken).toBeNull()
    expect(new URLSearchParams(seenBody).get('grant_type')).toBe('refresh_token')
    expect(new URLSearchParams(seenBody).get('refresh_token')).toBe('rt-1')
  })
})
