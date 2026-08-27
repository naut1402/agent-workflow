import { getCredential, resolveSecretRef } from './credentials.js'
import { ensureFreshOAuthToken } from './oauthCredentials.js'
import { AgenticApiProvider } from './providers/agenticApiProvider.js'
import { getProvider } from './registry.js'

export interface ListModelsInput {
  providerId: string
  baseURL?: string
  /** An already-saved credential to resolve server-side. */
  credentialId?: string
  /** Raw secret typed into ConnectionDialog's "+ Credential" panel but not saved yet. */
  secretValue?: string
}

export type ListModelsResult = { ok: true; models: string[] } | { ok: false; error: string }

/** Static aliases — `claude-code-cli` has no listModels API; user can still type a free-form id (creatable combo). */
const CLAUDE_CLI_MODELS = ['opus', 'sonnet', 'haiku']

async function resolveApiKey(
  input: ListModelsInput,
): Promise<{ ok: true; value: string } | { ok: false; error: string }> {
  // Fast path: caller already has the raw secret (not-yet-saved credential panel).
  if (input.secretValue?.trim()) return { ok: true, value: input.secretValue.trim() }

  if (!input.credentialId) return { ok: false, error: 'chọn credential hoặc nhập secret trước khi tải model' }

  const credential = getCredential(input.credentialId)
  if (!credential) return { ok: false, error: `credential "${input.credentialId}" không tồn tại` }

  const resolved = resolveSecretRef(credential)

  if (resolved.type === 'oauth') {
    return ensureFreshOAuthToken(credential.secretRef.slice('oauth:'.length), input.providerId)
  }

  if (resolved.type === 'env') {
    if (resolved.value) return { ok: true, value: resolved.value }
    return { ok: false, error: `biến môi trường "${resolved.key}" chưa được đặt trong server process` }
  }

  if (resolved.type === 'stored') {
    if (resolved.value) return { ok: true, value: resolved.value }
    // Most common in local dev: DASHBOARD_SECRET_KEY not set or changed after save.
    if (!process.env.DASHBOARD_SECRET_KEY) {
      return { ok: false, error: 'DASHBOARD_SECRET_KEY chưa được đặt — không thể đọc secret từ vault' }
    }
    return { ok: false, error: 'secret trong vault không tìm thấy hoặc bị lỗi giải mã' }
  }

  // none / cli-session / file / unknown — unusable for API providers.
  const hint = resolved.type === 'cli-session'
    ? 'credential này dành cho CLI agent, không dùng được cho API provider'
    : 'cần env:VAR_NAME, stored:<id>, hoặc oauth:<id>'
  return { ok: false, error: `credential thiếu secret hợp lệ — ${hint}` }
}

/** Server-side so the plaintext key never needs to reach the browser — see ConnectionDialog.vue's "Tải model" button. */
export async function listAvailableModels(input: ListModelsInput): Promise<ListModelsResult> {
  if (input.providerId === 'claude-code-cli') {
    return { ok: true, models: CLAUDE_CLI_MODELS }
  }

  const provider = getProvider(input.providerId)
  if (!provider || !(provider instanceof AgenticApiProvider)) {
    return { ok: false, error: 'provider này không hỗ trợ liệt kê model' }
  }

  const key = await resolveApiKey(input)
  if ('error' in key) return key

  try {
    const models = await provider.listModels(key.value, input.baseURL || '')
    return { ok: true, models }
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) }
  }
}
