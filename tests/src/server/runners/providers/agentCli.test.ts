import { describe, expect, test } from 'bun:test'
import {
  AGENT_CLI_PROVIDER_IDS,
  isAgentCliProviderId,
  providerFamilyOf,
} from '../../../../../src/features/runner/business/providers/agentCli.js'
import { createClaudeCodeCliProvider } from '../../../../../src/features/runner/business/providers/claude-code-cli.js'
import { createConsoleCommandProvider } from '../../../../../src/features/runner/business/providers/console-command.js'
import { isAgentCliProvider } from '../../../../../src/features/runner/business/providers/agentCli.js'

describe('agentCli family', () => {
  test('built-in agent CLI ids', () => {
    expect(AGENT_CLI_PROVIDER_IDS).toContain('claude-code-cli')
    expect(AGENT_CLI_PROVIDER_IDS).toContain('cursor-cli')
    expect(AGENT_CLI_PROVIDER_IDS).toContain('codex-cli')
    expect(isAgentCliProviderId('console-command')).toBe(false)
    expect(providerFamilyOf('console-command')).toBe('console-command')
    expect(providerFamilyOf('cursor-cli')).toBe('agent-cli')
  })

  test('AgentCliProvider vs console-command', () => {
    const agent = createClaudeCodeCliProvider()
    const console = createConsoleCommandProvider()
    expect(isAgentCliProvider(agent)).toBe(true)
    expect(agent.family).toBe('agent-cli')
    expect(typeof agent.agentCapabilities).toBe('function')
    expect(isAgentCliProvider(console)).toBe(false)
    expect(console.family).toBe('console-command')
  })
})
