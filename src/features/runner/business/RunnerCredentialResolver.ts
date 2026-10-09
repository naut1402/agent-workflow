import type { CredentialResolver } from '../../mcp/business/index.js'
import { getCredential, isDirectSecretType, resolveSecretRef } from './credentials.js'

/**
 * Adapter của port `CredentialResolver` (feature `mcp`) trên kho credential của
 * runner (vault + `credentials.json`). `mcp` 🚫 biết credential store — nó chỉ
 * hỏi "credential này giải ra secret gì".
 *
 * Chỉ secret trực tiếp (`isDirectSecretType`) mới đi vào header; kiểu khác
 * (`cli-session`, …) trả `null` ⇒ server từ xa bị bỏ header xác thực kèm cảnh báo.
 */
export class RunnerCredentialResolver implements CredentialResolver {
  secretFor(credentialId: string): string | null {
    const resolved = resolveSecretRef(getCredential(credentialId))
    if (!isDirectSecretType(resolved.type)) return null
    return (resolved as { value?: string | null }).value ?? null
  }
}
