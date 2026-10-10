import { describe, expect, test } from 'bun:test'
import {
  AGENT_CLI_PROVIDER_IDS,
  isAgentCliProviderId,
  providerFamilyFromId,
  type AgentCliProvider,
} from '../../../../../src/features/runner/business/providers/agentCli.js'
import {
  createClaudeCodeCliProvider,
  createLocalConsoleProvider,
} from '../../../../../src/features/runner/business/providers/claude-code-cli.js'
import { getProvider, listProviderCatalog } from '../../../../../src/features/runner/business/registry.js'
import { ConfigFlagMcpDelivery } from '../../../../../src/features/runner/business/mcpDelivery/ConfigFlagMcpDelivery.js'
import { NoMcpDelivery } from '../../../../../src/features/runner/business/mcpDelivery/NoMcpDelivery.js'
import { RunnerCredentialResolver } from '../../../../../src/features/runner/business/RunnerCredentialResolver.js'
import { createConsoleCommandProvider } from '../../../../../src/features/runner/business/providers/console-command.js'
import { isAgentCliProvider } from '../../../../../src/features/runner/business/providers/agentCli.js'

describe('agentCli family', () => {
  test('built-in agent CLI ids', () => {
    expect(AGENT_CLI_PROVIDER_IDS).toContain('claude-code-cli')
    expect(AGENT_CLI_PROVIDER_IDS).toContain('cursor-cli')
    expect(AGENT_CLI_PROVIDER_IDS).toContain('codex-cli')
    expect(isAgentCliProviderId('console-command')).toBe(false)
    expect(providerFamilyFromId('console-command')).toBe('console-command')
    expect(providerFamilyFromId('cursor-cli')).toBe('agent-cli')
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
 * TC-62…TC-64 — capabilities MCP. Cách giao MCP gắn vào provider
 * (`RunnerProvider.mcpDelivery`, lắp ráp ở `registry.ts`); catalog và
 * `agentCapabilities()` cùng đọc `mcpDelivery.kind` nên ba ca dưới khoá đúng
 * giá trị **hiện tại** từ provider đã đăng ký.
 *
 * `cursor-cli` nhận MCP qua `<workspace>/.cursor/mcp.json` ⇒
 * `'workspace-config-file'` (TC-P5-01). `codex-cli` vẫn `unsupported`: chưa cài
 * được CLI để xác minh. Họ `ai-api` ⇒ `'bridge-tools'` (D2 — trước đây
 * `unsupported` theo giả định A-4).
 */
describe('agentCli — MCP delivery', () => {
  // TC-62 · TC-P5-01 · TC-P5-02
  test('TC-62: provider đã đăng ký mang đúng cách giao', () => {
    expect(getProvider('claude-code-cli')!.mcpDelivery!.kind).toBe('config-file-flag')
    // TC-P5-01
    expect(getProvider('cursor-cli')!.mcpDelivery!.kind).toBe('workspace-config-file')
    // TC-P5-02 — 🚫 không đổi gì ngoài cursor ở họ agent-cli.
    expect(getProvider('codex-cli')!.mcpDelivery!.kind).toBe('unsupported')
    expect(getProvider('provider-la-hoac-chua-ton-tai')).toBeNull()
  })

  // TC-63
  test('TC-63: agentCapabilities().mcpDelivery — theo delivery đã gắn, mặc định `unsupported`', () => {
    for (const providerId of ['claude-code-cli', 'cursor-cli', 'codex-cli']) {
      const provider = getProvider(providerId) as AgentCliProvider
      expect(provider.agentCapabilities().mcpDelivery).toBe(provider.mcpDelivery!.kind)
    }

    // Dựng tay 🚫 truyền delivery ⇒ Null Object, 🚫 suy theo `providerId` nữa (G12).
    for (const providerId of ['claude-code-cli', 'cursor-cli', 'codex-cli']) {
      const provider = createLocalConsoleProvider({ providerId, defaultCliPath: 'x' })
      expect(provider.agentCapabilities().mcpDelivery).toBe('unsupported')
      expect(provider.mcpDelivery).toBeInstanceOf(NoMcpDelivery)
    }
    expect(createClaudeCodeCliProvider().agentCapabilities().mcpDelivery).toBe('unsupported')

    const forced = createLocalConsoleProvider({
      providerId: 'codex-cli',
      defaultCliPath: 'x',
      mcpDelivery: new ConfigFlagMcpDelivery(() => 'khong-dung', new RunnerCredentialResolver()),
    })
    expect(forced.agentCapabilities().mcpDelivery).toBe('config-file-flag')
  })

  // TC-64 — chỉ THÊM trường, 🚫 không thêm/bớt provider nào.
  test('TC-64: listProviderCatalog phơi mcpDelivery cho mọi entry = kind của provider', () => {
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
      expect(entry.mcpDelivery).toBe(getProvider(entry.id)?.mcpDelivery?.kind ?? 'unsupported')
    }
    // D2 — họ `ai-api` nạp tool vào vòng tool-use.
    expect(catalog.filter((e) => e.family === 'ai-api').map((e) => e.mcpDelivery)).toEqual(
      Array(4).fill('bridge-tools'),
    )
  })
})
