import { createClaudeCodeCliProvider } from './providers/claude-code-cli.js'
import { createCursorCliProvider } from './providers/cursor-cli.js'
import { createCodexCliProvider } from './providers/codex-cli.js'
import type { RunnerProvider } from './types.js'

const providers = new Map<string, RunnerProvider>()

function register(provider: RunnerProvider): void {
  providers.set(provider.providerId, provider)
}

register(createClaudeCodeCliProvider())
register(createCursorCliProvider())
register(createCodexCliProvider())

export function getProvider(providerId: string): RunnerProvider | null {
  return providers.get(providerId) || null
}

export function listProviderIds(): string[] {
  return [...providers.keys()]
}
