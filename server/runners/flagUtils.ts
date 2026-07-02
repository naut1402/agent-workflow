import { resolveSecretRef } from './credentials.js'
import type { CredentialProfile } from './types.js'

/** --bare only supports ANTHROPIC_API_KEY; cli-session needs OAuth/keychain. */
export function resolveEffectiveFlags(flags: unknown, credential: CredentialProfile): string[] {
  const list = Array.isArray(flags) ? [...flags] : []
  const auth = resolveSecretRef(credential)
  if (auth.type === 'cli-session') {
    return list.filter((f) => f !== '--bare')
  }
  return list
}
