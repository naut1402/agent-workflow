import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mcpRegistry } from '../../../../../../src/features/mcp/business/index.js'
import { McpJobDelivery } from '../../../../../../src/features/runner/business/mcpDelivery/McpJobDelivery.js'
import { WorkspaceFileMcpDelivery } from '../../../../../../src/features/runner/business/mcpDelivery/WorkspaceFileMcpDelivery.js'
import {
  cleanupOrphanedMcpDeliveries,
  getProvider,
  listProviderCatalog,
  registerProvider,
} from '../../../../../../src/features/runner/business/registry.js'
import { RunnerCredentialResolver } from '../../../../../../src/features/runner/business/RunnerCredentialResolver.js'
import type { McpDelivery, RunnerProvider } from '../../../../../../src/features/runner/business/types.js'

/**
 * Chỗ lắp ráp `runner/business/registry.ts` — provider nào nhận MCP bằng cách
 * nào, catalog trả gì cho FE (D2), và đường dọn mồ côi lúc bootstrap.
 */

const EXPECTED_KIND: Record<string, McpDelivery> = {
  'claude-code-cli': 'config-file-flag',
  'cursor-cli': 'workspace-config-file',
  'codex-cli': 'unsupported',
  'console-command': 'unsupported',
  'anthropic-api': 'bridge-tools',
  'openai-api': 'bridge-tools',
  'gemini-api': 'bridge-tools',
  'xai-api': 'bridge-tools',
}

describe('registry — lắp ráp delivery theo provider', () => {
  test('mỗi provider dựng sẵn mang đúng `kind`; console-command 🚫 khai delivery', () => {
    for (const [id, kind] of Object.entries(EXPECTED_KIND)) {
      const provider = getProvider(id)
      expect(provider, id).not.toBeNull()
      if (id === 'console-command') {
        expect(provider!.mcpDelivery).toBeUndefined()
        continue
      }
      expect(provider!.mcpDelivery?.kind, id).toBe(kind)
    }
  })

  test('chỉ claude nhận entry tự gắn (`acceptsSelfServer`) — tuyến `mcp` của node điều phối', () => {
    const accepting = Object.keys(EXPECTED_KIND).filter((id) => getProvider(id)?.mcpDelivery?.acceptsSelfServer)
    expect(accepting).toEqual(['claude-code-cli'])
  })

  test('4 provider `ai-api` dùng CHUNG một bridge (một adapter credential)', () => {
    const bridges = new Set(['anthropic-api', 'openai-api', 'gemini-api', 'xai-api'].map((id) => getProvider(id)!.mcpDelivery))
    expect(bridges.size).toBe(1)
  })

  test('agentCapabilities().mcpDelivery = kind của delivery đã lắp', () => {
    for (const id of ['claude-code-cli', 'cursor-cli', 'codex-cli']) {
      const provider = getProvider(id) as RunnerProvider & { agentCapabilities(): { mcpDelivery: McpDelivery } }
      expect(provider.agentCapabilities().mcpDelivery, id).toBe(EXPECTED_KIND[id])
    }
  })
})

describe('listProviderCatalog — `mcpDelivery` lấy từ provider (D2)', () => {
  test('đủ 8 entry, đúng thứ tự cũ; `ai-api` ⇒ `bridge-tools`, codex / console ⇒ `unsupported`', () => {
    const catalog = listProviderCatalog()
    expect(catalog.map((e) => e.id)).toEqual(Object.keys(EXPECTED_KIND))
    for (const entry of catalog) {
      expect(entry.mcpDelivery, entry.id).toBe(EXPECTED_KIND[entry.id])
    }
  })

  test('provider bị thay bằng stub 🚫 khai delivery ⇒ catalog rơi về `unsupported`', () => {
    const original = getProvider('cursor-cli')!
    try {
      registerProvider({ ...original, mcpDelivery: undefined } as RunnerProvider)
      expect(listProviderCatalog().find((e) => e.id === 'cursor-cli')!.mcpDelivery).toBe('unsupported')
    } finally {
      registerProvider(original)
    }
    expect(listProviderCatalog().find((e) => e.id === 'cursor-cli')!.mcpDelivery).toBe('workspace-config-file')
  })

  test('mỗi lần gọi trả bản sao — sửa kết quả 🚫 lọt vào lần sau', () => {
    const first = listProviderCatalog()
    first[0].label = 'đã sửa'
    expect(listProviderCatalog()[0].label).not.toBe('đã sửa')
  })
})

describe('cleanupOrphanedMcpDeliveries — dọn mồ côi lúc bootstrap', () => {
  let home: string
  let workspace: string
  const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-mcp-cleanup-home-'))
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-mcp-cleanup-ws-'))
    process.env.DEV_TEAM_DASHBOARD_HOME = home
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
    else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(workspace, { recursive: true, force: true })
  })

  test('dọn cả file job của claude lẫn workspace cursor bỏ lại sau `kill -9`', async () => {
    const runtime = path.join(home, 'mcp-runtime')
    fs.mkdirSync(runtime, { recursive: true })
    fs.writeFileSync(path.join(runtime, 'job-mo-coi.json'), '{"mcpServers":{}}', 'utf8')

    mcpRegistry.upsert({ id: 'on1', label: 'on1', enabled: true, transport: 'stdio', command: 'npx', args: [], env: {} })
    // Cùng đường `registryHome()/mcp-runtime` với delivery đã lắp ráp — 🚫 gọi `dispose()`.
    const orphan = await new WorkspaceFileMcpDelivery(() => runtime, new RunnerCredentialResolver()).prepare({
      ids: ['on1'],
      workspace,
      jobId: 'job-cursor-mo-coi',
    })
    expect(orphan).not.toBeNull()
    expect(fs.existsSync(path.join(workspace, '.cursor', 'mcp.json'))).toBe(true)

    cleanupOrphanedMcpDeliveries()

    expect(fs.existsSync(path.join(runtime, 'job-mo-coi.json'))).toBe(false)
    expect(fs.existsSync(path.join(workspace, '.cursor'))).toBe(false)
    expect(JSON.parse(fs.readFileSync(path.join(runtime, 'cursor-workspaces.json'), 'utf8')).entries).toEqual([])
  })

  test('🚫 có gì để dọn ⇒ 🚫 ném', () => {
    expect(() => cleanupOrphanedMcpDeliveries()).not.toThrow()
  })

  test('một lượt cho mỗi `kind` — provider dùng chung cách giao 🚫 dọn lặp', () => {
    class CountingDelivery extends McpJobDelivery<null> {
      calls = 0
      constructor(readonly kind: McpDelivery) {
        super()
      }
      protected attach(): null {
        return null
      }
      override cleanupOrphans(): void {
        this.calls++
      }
    }
    const codex = getProvider('codex-cli')!
    const gemini = getProvider('gemini-api')!
    // codex là provider ĐẦU TIÊN mang `unsupported` ⇒ được gọi đúng một lần;
    // gemini đứng SAU openai (cùng `bridge-tools`) ⇒ 🚫 được gọi.
    const first = new CountingDelivery('unsupported')
    const duplicate = new CountingDelivery('bridge-tools')
    try {
      registerProvider({ ...codex, mcpDelivery: first } as RunnerProvider)
      registerProvider({ ...gemini, mcpDelivery: duplicate } as RunnerProvider)

      cleanupOrphanedMcpDeliveries()

      expect(first.calls).toBe(1)
      expect(duplicate.calls).toBe(0)
    } finally {
      registerProvider(codex)
      registerProvider(gemini)
    }
  })
})
