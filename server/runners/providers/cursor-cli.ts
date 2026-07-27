import { createLocalConsoleProvider } from './claude-code-cli.js'
import type { RunnerProvider } from '../types.js'

export function createCursorCliProvider(): RunnerProvider {
  return createLocalConsoleProvider({
    providerId: 'cursor-cli',
    defaultCliPath: 'cursor',
    claudeStyleArgs: false,
    sessionCapture: 'parse-json',
  })
}
