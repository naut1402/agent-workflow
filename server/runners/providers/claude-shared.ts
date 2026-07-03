import { resolveSecretRef } from '../credentials.js'
import type { CredentialProfile, ResolvedAgent } from '../types.js'

export function buildPrompt(resolvedAgent: ResolvedAgent, userPrompt: string): string {
  const system = resolvedAgent.systemPrompt?.trim()
  if (!system) return userPrompt
  return `## Agent instructions\n\n${system}\n\n## Task\n\n${userPrompt}`
}

/** --bare only supports ANTHROPIC_API_KEY; cli-session needs OAuth/keychain. */
export function resolveEffectiveFlags(flags: unknown, credential: CredentialProfile): string[] {
  const list = Array.isArray(flags) ? [...flags] : []
  const auth = resolveSecretRef(credential)
  if (auth.type === 'cli-session') {
    return list.filter((f) => f !== '--bare')
  }
  return list
}

export function buildClaudeArgv(opts: {
  runnerConfig: Record<string, unknown>
  credential: CredentialProfile
  prompt: string
}): string[] {
  const flags = resolveEffectiveFlags(opts.runnerConfig.flags, opts.credential)
  const args = [...flags, '-p', opts.prompt]
  if (opts.runnerConfig.allowedTools) {
    args.push('--allowedTools', String(opts.runnerConfig.allowedTools))
  }
  if (opts.runnerConfig.dangerouslySkipPermissions) {
    args.push('--dangerously-skip-permissions')
  }
  return args
}

export function buildChildEnv(credential: CredentialProfile): NodeJS.ProcessEnv {
  const env = { ...process.env }
  const auth = resolveSecretRef(credential)
  if (auth.type === 'env' && auth.key && auth.value) {
    env[auth.key] = auth.value
  }
  return env
}
