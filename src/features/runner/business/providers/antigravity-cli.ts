import { createLocalConsoleProvider } from './claude-code-cli.js'
import type { AgentCliProvider } from './agentCli.js'

export function createAntigravityCliProvider(): AgentCliProvider {
  return createLocalConsoleProvider({
    providerId: 'antigravity-cli',
    defaultCliPath: 'agy',
    claudeStyleArgs: false,
    sessionCapture: 'antigravity-json',
  })
}
