import { createClaudeCodeCliProvider } from './providers/claude-code-cli.js'
import { createCursorCliProvider } from './providers/cursor-cli.js'
import { createCodexCliProvider } from './providers/codex-cli.js'
import { createConsoleCommandProvider } from './providers/console-command.js'
import type { RunnerProvider } from './types.js'

const providers = new Map<string, RunnerProvider>()

function register(provider: RunnerProvider): void {
  providers.set(provider.providerId, provider)
}

register(createClaudeCodeCliProvider())
register(createCursorCliProvider())
register(createCodexCliProvider())
register(createConsoleCommandProvider())

/**
 * Register (or replace) a provider at runtime. Built-in providers are registered
 * at module load; this is the seam tests use to inject a stub provider (e.g. an
 * approval-flow provider that writes a proposed edit into the scratch workspace
 * without spawning a real CLI).
 */
export function registerProvider(provider: RunnerProvider): void {
  register(provider)
}

export function getProvider(providerId: string): RunnerProvider | null {
  return providers.get(providerId) || null
}

export function listProviderIds(): string[] {
  return [...providers.keys()]
}
