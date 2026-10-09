function envPrefixFor(providerId: string): string {
  return `RUNNER_OAUTH_${providerId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
}

export interface OAuthProviderConfig {
  authorizeUrl: string
  tokenUrl: string
  clientId: string
  /** Optional — public/PKCE-only OAuth clients (e.g. installed/native apps) don't need one. */
  clientSecret?: string
  scope: string
}

export function getOAuthConfig(providerId: string): OAuthProviderConfig | null {
  const prefix = envPrefixFor(providerId)
  const authorizeUrl = process.env[`${prefix}_AUTHORIZE_URL`]
  const tokenUrl = process.env[`${prefix}_TOKEN_URL`]
  const clientId = process.env[`${prefix}_CLIENT_ID`]
  const scope = process.env[`${prefix}_SCOPE`]
  if (!authorizeUrl || !tokenUrl || !clientId || !scope) return null
  return { authorizeUrl, tokenUrl, clientId, clientSecret: process.env[`${prefix}_CLIENT_SECRET`], scope }
}

export function isOAuthCapable(providerId: string): boolean {
  return getOAuthConfig(providerId) !== null
}

export function buildAuthorizeUrl(
  config: OAuthProviderConfig,
  opts: { redirectUri: string; state: string; codeChallenge: string },
): string {
  const url = new URL(config.authorizeUrl)
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', opts.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', config.scope)
  url.searchParams.set('state', opts.state)
  url.searchParams.set('code_challenge', opts.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  return url.toString()
}

export interface TokenResponse {
  accessToken: string
  refreshToken: string | null
  expiresAt: string | null
}

function parseTokenResponse(data: any): TokenResponse {
  const accessToken = String(data.access_token || '')
  const expiresIn = Number(data.expires_in)
  return {
    accessToken,
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : null,
    expiresAt: Number.isFinite(expiresIn) ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
  }
}

async function postTokenRequest(config: OAuthProviderConfig, params: Record<string, string>): Promise<TokenResponse> {
  const body = new URLSearchParams({ client_id: config.clientId, ...params })
  if (config.clientSecret) body.set('client_secret', config.clientSecret)
  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `token endpoint returned ${res.status}`)
  }
  return parseTokenResponse(data)
}

export function exchangeCode(
  config: OAuthProviderConfig,
  opts: { code: string; redirectUri: string; codeVerifier: string },
): Promise<TokenResponse> {
  return postTokenRequest(config, {
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: opts.redirectUri,
    code_verifier: opts.codeVerifier,
  })
}

export function refreshAccessToken(config: OAuthProviderConfig, refreshToken: string): Promise<TokenResponse> {
  return postTokenRequest(config, { grant_type: 'refresh_token', refresh_token: refreshToken })
}
