import { createLocalConsoleProvider, type LocalConsoleProviderOptions } from './claude-code-cli.js'
import type { AgentCliProvider } from './agentCli.js'

export function createCursorCliProvider(
  deps: Pick<LocalConsoleProviderOptions, 'mcpDelivery'> = {},
): AgentCliProvider {
  return createLocalConsoleProvider({
    providerId: 'cursor-cli',
    defaultCliPath: 'agent',
    claudeStyleArgs: false,
    sessionCapture: 'parse-json',
    mcpDelivery: deps.mcpDelivery,
  })
}
