import { createLocalConsoleProvider } from './claude-code-cli.js'
import type { RunnerProvider } from '../types.js'

export function createCodexCliProvider(): RunnerProvider {
  return createLocalConsoleProvider({
    providerId: 'codex-cli',
    defaultCliPath: 'codex',
    claudeStyleArgs: false,
  })
}
