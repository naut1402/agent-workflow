import { createLocalConsoleProvider } from './claude-code-cli.js'
import type { AgentCliProvider } from './agentCli.js'

export function createCursorCliProvider(): AgentCliProvider {
  return createLocalConsoleProvider({
    providerId: 'cursor-cli',
    defaultCliPath: 'agent',
    claudeStyleArgs: false,
    sessionCapture: 'parse-json',
  })
}
