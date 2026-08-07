import { createLocalConsoleProvider } from './claude-code-cli.js'
import type { AgentCliProvider } from './agentCli.js'

export function createCodexCliProvider(): AgentCliProvider {
  return createLocalConsoleProvider({
    providerId: 'codex-cli',
    defaultCliPath: 'codex',
    claudeStyleArgs: false,
    sessionCapture: 'none',
  })
}
