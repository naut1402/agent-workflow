import crypto from 'node:crypto'
import { getOAuthConfig, buildAuthorizeUrl, exchangeCode, refreshAccessToken } from './oauthProviders.js'
import { storeSecret, readSecret } from './secretVault.js'
import { upsertCredential } from './credentials.js'

/**
 * Orchestrates the browser OAuth connect flow started from `ConnectionDialog.vue`
 * ("Connect via browser"): `start` opens the provider's consent screen, then
 * either the provider redirects the user's browser straight back to
 * `completeFromCallback` (when that redirect is reachable from the user's
 * browser), or — if it isn't (dashboard not reachable at that address, e.g.
 * behind a firewall) — the user pastes the URL/code the provider showed them
 * into the dialog, which goes through `completeFromPaste` instead. Both paths
 * exchange the same PKCE `code_verifier` for a token and land in the same
 * encrypted vault entry, so the rest of the app never needs to know which one
 * ran.
 */

const PENDING_TTL_MS = 10 * 60_000
/** Refresh this far ahead of `expiresAt` — avoids a request racing an expiry mid-flight. */
const REFRESH_MARGIN_MS = 5 * 60_000

interface PendingOAuth {
  providerId: string
  label: string
  codeVerifier: string
  redirectUri: string
  createdAt: number
  status: 'pending' | 'done' | 'error'
  credentialId?: string
  error?: string
}

const pending = new Map<string, PendingOAuth>()

function pruneExpiredPending(): void {
  const now = Date.now()
  for (const [state, entry] of pending) {
    if (now - entry.createdAt > PENDING_TTL_MS) pending.delete(state)
  }
}

function base64url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function startOAuth(
  providerId: string,
  label: string,
  redirectUri: string,
): { ok: true; state: string; authorizeUrl: string } | { ok: false; error: string } {
  pruneExpiredPending()
  const config = getOAuthConfig(providerId)
  if (!config) return { ok: false, error: `oauth not configured for provider: ${providerId}` }

  const state = crypto.randomUUID()
  const codeVerifier = base64url(crypto.randomBytes(32))
  const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest())

  pending.set(state, {
    providerId,
    label: label || providerId,
    codeVerifier,
    redirectUri,
    createdAt: Date.now(),
    status: 'pending',
  })

  return { ok: true, state, authorizeUrl: buildAuthorizeUrl(config, { redirectUri, state, codeChallenge }) }
}

async function complete(state: string, code: string): Promise<{ ok: true; credentialId: string } | { ok: false; error: string }> {
  pruneExpiredPending()
  const entry = pending.get(state)
  if (!entry) return { ok: false, error: 'unknown or expired oauth state' }
  const config = getOAuthConfig(entry.providerId)
  if (!config) return { ok: false, error: `oauth not configured for provider: ${entry.providerId}` }

  try {
    const token = await exchangeCode(config, { code, redirectUri: entry.redirectUri, codeVerifier: entry.codeVerifier })
    const credentialId = crypto.randomUUID()
    storeSecret(credentialId, {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt,
    })
    const result = upsertCredential({
      id: credentialId,
      provider: entry.providerId,
      label: entry.label,
      secretRef: `oauth:${credentialId}`,
    })
    if ('error' in result) {
      entry.status = 'error'
      entry.error = result.error
      return { ok: false, error: result.error || 'failed to save credential' }
    }
    entry.status = 'done'
    entry.credentialId = credentialId
    return { ok: true, credentialId }
  } catch (err: any) {
    const message = String(err?.message ?? err)
    entry.status = 'error'
    entry.error = message
    return { ok: false, error: message }
  }
}

/** Redirect-mode completion — provider sent the user's browser straight back to our own callback route. */
export function completeFromCallback(state: string, code: string) {
  return complete(state, code)
}

/**
 * Manual/paste-mode completion — the redirect wasn't reachable from the
 * user's browser, so they copied the resulting URL (or bare code) back into
 * the dialog. Accepts either form.
 */
export function completeFromPaste(state: string, pasted: string) {
  const trimmed = pasted.trim()
  let code = trimmed
  try {
    const url = new URL(trimmed)
    code = url.searchParams.get('code') || trimmed
  } catch {
    /* not a URL — treat the whole input as the code */
  }
  return complete(state, code)
}

export function getOAuthStatus(state: string): { status: PendingOAuth['status']; credentialId?: string; error?: string } | null {
  const entry = pending.get(state)
  if (!entry) return null
  return { status: entry.status, credentialId: entry.credentialId, error: entry.error }
}

/**
 * Returns a still-valid access token for an `oauth:<vaultKey>` credential,
 * refreshing it first if it's within `REFRESH_MARGIN_MS` of expiring (or
 * already expired). Called from `AgenticApiProvider.execute()` right before
 * a request goes out — never cached beyond that single call.
 */
export async function ensureFreshOAuthToken(
  vaultKey: string,
  providerId: string,
): Promise<{ ok: true; value: string } | { ok: false; error: string }> {
  const entry = readSecret<{ accessToken?: string; refreshToken?: string | null; expiresAt?: string | null }>(vaultKey)
  if (!entry?.accessToken) return { ok: false, error: 'oauth credential not found or unreadable — connect again' }

  const expiresAt = entry.expiresAt ? Date.parse(entry.expiresAt) : NaN
  const needsRefresh = Number.isFinite(expiresAt) && expiresAt - Date.now() < REFRESH_MARGIN_MS
  if (!needsRefresh) return { ok: true, value: entry.accessToken }

  if (!entry.refreshToken) return { ok: false, error: 'oauth token expired and no refresh token available — connect again' }
  const config = getOAuthConfig(providerId)
  if (!config) return { ok: false, error: `oauth not configured for provider: ${providerId}` }

  try {
    const refreshed = await refreshAccessToken(config, entry.refreshToken)
    storeSecret(vaultKey, {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? entry.refreshToken,
      expiresAt: refreshed.expiresAt,
    })
    return { ok: true, value: refreshed.accessToken }
  } catch (err: any) {
    return { ok: false, error: `oauth refresh failed — connect again (${String(err?.message ?? err)})` }
  }
}

/** Test-only: clears in-memory pending state between test files. */
export function _resetOAuthPendingForTest(): void {
  pending.clear()
}
