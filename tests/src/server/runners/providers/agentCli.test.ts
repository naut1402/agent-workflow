import { describe, expect, test } from 'bun:test'
import {
  AGENT_CLI_PROVIDER_IDS,
  isAgentCliProviderId,
  mcpDeliveryOf,
  providerFamilyOf,
} from '../../../../../src/features/runner/business/providers/agentCli.js'
import {
  createClaudeCodeCliProvider,
  createLocalConsoleProvider,
} from '../../../../../src/features/runner/business/providers/claude-code-cli.js'
import { listProviderCatalog } from '../../../../../src/features/runner/business/connections.js'
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

  test('does not advertise token usage until execute() maps real usage', () => {
    // Footer only shows tokens when ExecuteResult.tokenUsage is set; until then
    // supportsTokenUsage must stay false (PR #189 review).
    expect(createClaudeCodeCliProvider().agentCapabilities().supportsTokenUsage).toBe(false)
  })
})

/**
 * TC-62…TC-64 — capabilities MCP. `mcpDeliveryOf` là nguồn sự thật duy nhất cho
 * cả provider lẫn UI, nên ba ca dưới khoá đúng giá trị **hiện tại**: cursor và
 * codex là `unsupported` TRONG TASK NÀY (P5 ngoài scope), 🚫 không đoán trước.
 */
describe('agentCli — MCP delivery', () => {
  // TC-62
  test('TC-62: mcpDeliveryOf', () => {
    expect(mcpDeliveryOf('claude-code-cli')).toBe('config-file-flag')
    expect(mcpDeliveryOf('cursor-cli')).toBe('unsupported')
    expect(mcpDeliveryOf('codex-cli')).toBe('unsupported')
    expect(mcpDeliveryOf('')).toBe('unsupported')
    expect(mcpDeliveryOf('provider-la-hoac-chua-ton-tai')).toBe('unsupported')
  })

  // TC-63
  test('TC-63: agentCapabilities().mcpDelivery — mặc định theo id, override thắng', () => {
    expect(createClaudeCodeCliProvider().agentCapabilities().mcpDelivery).toBe('config-file-flag')

    for (const providerId of ['claude-code-cli', 'cursor-cli', 'codex-cli']) {
      const provider = createLocalConsoleProvider({ providerId, defaultCliPath: 'x' })
      expect(provider.agentCapabilities().mcpDelivery).toBe(mcpDeliveryOf(providerId))
    }

    const forced = createLocalConsoleProvider({
      providerId: 'claude-code-cli',
      defaultCliPath: 'x',
      mcpDelivery: 'unsupported',
    })
    expect(forced.agentCapabilities().mcpDelivery).toBe('unsupported')
  })

  // TC-64 — chỉ THÊM trường, 🚫 không thêm/bớt provider nào.
  test('TC-64: listProviderCatalog phơi mcpDelivery cho mọi entry', () => {
    const catalog = listProviderCatalog()
    expect(catalog).toHaveLength(8)
    expect(catalog.map((e) => e.id)).toEqual([
      'claude-code-cli',
      'cursor-cli',
      'codex-cli',
      'console-command',
      'anthropic-api',
      'openai-api',
      'gemini-api',
      'xai-api',
    ])
    for (const entry of catalog) {
      expect(entry).toHaveProperty('mcpDelivery')
      expect(entry.mcpDelivery).toBe(mcpDeliveryOf(entry.id))
    }
  })
})
