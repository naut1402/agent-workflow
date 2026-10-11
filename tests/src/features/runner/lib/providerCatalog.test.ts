import { describe, expect, it } from 'vitest'
import {
  acceptsAgentOf,
  defaultBaseUrlOf,
  hasStaticModelsOf,
  inferProviderIdFromCommand,
  modelHintOf,
  providerEntryOf,
  secretEnvHintOf,
  supportsAllowedToolsOf,
} from '@/features/runner/lib/providerCatalog'
import type { ProviderEntry } from '@/features/runner/types'

// #440 · Tfb77cf90-P1 — UI hỏi provider "làm được gì" qua `ProviderDescriptor`
// BE trả kèm catalog, thay cho bảng / luật theo `providerId` rải trong component.
// Catalog thiếu trường (response / fixture cũ) thì rơi về luật cũ — hành vi không đổi.

/** Provider lạ khai đủ descriptor — chứng minh UI không cần biết id. */
const NEW_CLI: ProviderEntry = {
  id: 'p1-new-cli',
  kind: 'local-console',
  label: 'New CLI',
  family: 'agent-cli',
  acceptsAgent: true,
  modelListing: 'static',
  supportsAllowedTools: true,
  localCommand: { id: 'newcli', command: 'newcli', match: { base: '^newcli$', path: 'new-cli-bin' } },
}
const NEW_SHELL: ProviderEntry = {
  id: 'p1-new-shell',
  kind: 'local-console',
  label: 'Shell 2',
  family: 'console-command',
  acceptsAgent: false,
  modelListing: 'none',
}
const NEW_API: ProviderEntry = {
  id: 'p1-new-api',
  kind: 'ai-provider',
  label: 'New API',
  family: 'ai-api',
  acceptsAgent: true,
  modelListing: 'api',
  defaultBaseURL: 'https://new.test/v1',
  modelHint: 'new-1',
  secretEnvHint: 'env:NEW_KEY',
}
const CATALOG = [NEW_CLI, NEW_SHELL, NEW_API]

describe('providerCatalog — đọc descriptor', () => {
  it('providerEntryOf tra theo id, thiếu id / không có ⇒ null', () => {
    expect(providerEntryOf('p1-new-api', CATALOG)).toBe(NEW_API)
    expect(providerEntryOf('khong-co', CATALOG)).toBeNull()
    expect(providerEntryOf(undefined, CATALOG)).toBeNull()
    expect(providerEntryOf('p1-new-api', null)).toBeNull()
  })

  it('acceptsAgent / model tĩnh / allowedTools theo khai báo, không theo id', () => {
    expect(acceptsAgentOf('p1-new-shell', CATALOG)).toBe(false)
    expect(acceptsAgentOf('p1-new-cli', CATALOG)).toBe(true)
    expect(hasStaticModelsOf('p1-new-cli', CATALOG)).toBe(true)
    expect(hasStaticModelsOf('p1-new-api', CATALOG)).toBe(false)
    expect(supportsAllowedToolsOf('p1-new-cli', CATALOG)).toBe(true)
    expect(supportsAllowedToolsOf('p1-new-shell', CATALOG)).toBe(false)
  })

  it('descriptor đè bảng dự phòng: claude-code-cli khai không hỗ trợ ⇒ không hiện', () => {
    const declared: ProviderEntry[] = [
      { id: 'claude-code-cli', kind: 'local-console', label: 'x', acceptsAgent: true, modelListing: 'none', supportsAllowedTools: false },
    ]
    expect(hasStaticModelsOf('claude-code-cli', declared)).toBe(false)
    expect(supportsAllowedToolsOf('claude-code-cli', declared)).toBe(false)
  })

  it('placeholder base URL / model / secretRef lấy từ descriptor', () => {
    expect(defaultBaseUrlOf('p1-new-api', CATALOG)).toBe('https://new.test/v1')
    expect(modelHintOf('p1-new-api', CATALOG)).toBe('new-1')
    expect(secretEnvHintOf('p1-new-api', CATALOG)).toBe('env:NEW_KEY')
    expect(defaultBaseUrlOf('khong-co', CATALOG)).toBe('')
  })

  it('suy provider từ lệnh: tên file theo `match.base`, cả đường dẫn theo `match.path`', () => {
    expect(inferProviderIdFromCommand('/usr/bin/newcli', CATALOG)).toBe('p1-new-cli')
    expect(inferProviderIdFromCommand('C:\\tools\\NEWCLI.exe', CATALOG)).toBe('p1-new-cli')
    expect(inferProviderIdFromCommand('/opt/new-cli-bin/run', CATALOG)).toBe('p1-new-cli')
    expect(inferProviderIdFromCommand('/usr/bin/claude', CATALOG)).toBeNull()
  })
})

describe('providerCatalog — dự phòng khi catalog thiếu trường (hành vi cũ)', () => {
  it('lệnh console không chạy agent; mọi id khác chạy agent', () => {
    expect(acceptsAgentOf('console-command', [])).toBe(false)
    expect(acceptsAgentOf('claude-code-cli', [])).toBe(true)
    expect(acceptsAgentOf('', [])).toBe(true)
  })

  it('chỉ claude-code-cli có model tĩnh và allowedTools', () => {
    expect(hasStaticModelsOf('claude-code-cli', null)).toBe(true)
    expect(hasStaticModelsOf('cursor-cli', null)).toBe(false)
    expect(supportsAllowedToolsOf('claude-code-cli', [{ id: 'claude-code-cli', kind: 'local-console', label: 'x' }])).toBe(true)
    expect(supportsAllowedToolsOf('codex-cli', null)).toBe(false)
  })

  it('placeholder của 4 provider API như bảng cũ', () => {
    expect(defaultBaseUrlOf('openai-api', [])).toBe('https://api.openai.com/v1')
    expect(modelHintOf('gemini-api', [])).toBe('gemini-2.5-pro')
    expect(secretEnvHintOf('xai-api', [])).toBe('env:XAI_API_KEY')
  })

  it('suy provider từ lệnh như regex cũ', () => {
    expect(inferProviderIdFromCommand('/usr/local/bin/claude', [])).toBe('claude-code-cli')
    expect(inferProviderIdFromCommand('C:\\bin\\agent.cmd', [])).toBe('cursor-cli')
    expect(inferProviderIdFromCommand('/home/u/.local/cursor-agent/bin/run', [])).toBe('cursor-cli')
    expect(inferProviderIdFromCommand('/opt/my-codex', [])).toBe('codex-cli')
    expect(inferProviderIdFromCommand('/bin/sh', [])).toBeNull()
  })
})
