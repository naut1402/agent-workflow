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

async function resolveApiKey(
  input: ListModelsInput,
): Promise<{ ok: true; value: string } | { ok: false; error: string }> {
  if (input.secretValue?.trim()) return { ok: true, value: input.secretValue.trim() }
  if (!input.credentialId) return { ok: false, error: 'chọn credential hoặc nhập secret trước khi tải model' }

  const credential = getCredential(input.credentialId)
  const resolved = resolveSecretRef(credential)
  if (resolved.type === 'oauth') {
    if (!credential) return { ok: false, error: 'credential không tồn tại' }
    return ensureFreshOAuthToken(credential.secretRef.slice('oauth:'.length), input.providerId)
  }
  if ((resolved.type === 'env' || resolved.type === 'stored') && resolved.value) {
    return { ok: true, value: resolved.value }
  }
  return { ok: false, error: 'credential thiếu secret hợp lệ (cần env:VAR_NAME hoặc secret đã lưu)' }
}

/** Server-side so the plaintext key never needs to reach the browser — see ConnectionDialog.vue's "Tải model" button. */
export async function listAvailableModels(input: ListModelsInput): Promise<ListModelsResult> {
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
