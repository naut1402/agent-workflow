// xem docs/architecture/code/runner.md §4

import { joinPath } from '../../../../backend/lib/fileHelper.js'
import { registryHome } from '../../../../backend/registry.js'
import { useCredentialResolver } from '../../../mcp/business/index.js'
import { ConfigFlagMcpDelivery } from '../mcpDelivery/ConfigFlagMcpDelivery.js'
import { NoMcpDelivery } from '../mcpDelivery/NoMcpDelivery.js'
import { ToolBridgeMcpDelivery } from '../mcpDelivery/ToolBridgeMcpDelivery.js'
import { WorkspaceFileMcpDelivery } from '../mcpDelivery/WorkspaceFileMcpDelivery.js'
import { RunnerCredentialResolver } from '../RunnerCredentialResolver.js'
import type { ProviderCatalogEntry } from '../types.js'
import { AnthropicCompatibleProvider } from './AnthropicCompatibleProvider.js'
import { ClaudeCliProvider } from './ClaudeCliProvider.js'
import { CodexCliProvider } from './CodexCliProvider.js'
import { ConsoleCommandProvider } from './ConsoleCommandProvider.js'
import { CursorCliProvider } from './CursorCliProvider.js'
import { OpenAiCompatibleProvider } from './OpenAiCompatibleProvider.js'
import type {
  McpDelivery,
  ProviderDescriptor,
  ProviderFamily,
  RegisteredProvider,
  RunnerProvider,
  TranscriptFormat,
} from './RunnerProvider.js'

const builtins = new Map<string, RegisteredProvider>()
const providers = new Map<string, RegisteredProvider>()

function builtin(provider: RegisteredProvider): void {
  builtins.set(provider.providerId, provider)
  providers.set(provider.providerId, provider)
}

// xem docs/mcp/client.md §7
const mcpCredentials = new RunnerCredentialResolver()
const mcpRuntimeDir = () => joinPath(registryHome(), 'mcp-runtime')
const mcpToolBridge = new ToolBridgeMcpDelivery(mcpCredentials)

useCredentialResolver(mcpCredentials)

builtin(new ClaudeCliProvider({ mcpDelivery: new ConfigFlagMcpDelivery(mcpRuntimeDir, mcpCredentials) }))
builtin(new CursorCliProvider({ mcpDelivery: new WorkspaceFileMcpDelivery(mcpRuntimeDir, mcpCredentials) }))
builtin(new CodexCliProvider())
builtin(new ConsoleCommandProvider())
builtin(new AnthropicCompatibleProvider('anthropic-api', 'https://api.anthropic.com', mcpToolBridge, {
  label: 'Anthropic API', modelHint: 'claude-opus-4-6', secretEnvHint: 'env:ANTHROPIC_API_KEY',
}))
builtin(new OpenAiCompatibleProvider('openai-api', 'https://api.openai.com/v1', mcpToolBridge, {
  label: 'OpenAI API', modelHint: 'gpt-4.1', secretEnvHint: 'env:OPENAI_API_KEY',
}))
builtin(new OpenAiCompatibleProvider('gemini-api', 'https://generativelanguage.googleapis.com/v1beta/openai', mcpToolBridge, {
  label: 'Gemini API', modelHint: 'gemini-2.5-pro', secretEnvHint: 'env:GEMINI_API_KEY',
}))
builtin(new OpenAiCompatibleProvider('xai-api', 'https://api.x.ai/v1', mcpToolBridge, {
  label: 'xAI API', modelHint: 'grok-4', secretEnvHint: 'env:XAI_API_KEY',
}))

/** Built-in Agent CLI provider ids, derived from the built-in providers. */
export const AGENT_CLI_PROVIDER_IDS: readonly string[] = [...builtins.values()]
  .filter((p) => p.family === 'agent-cli')
  .map((p) => p.providerId)

export function isAgentCliProviderId(providerId: string): boolean {
  return AGENT_CLI_PROVIDER_IDS.includes(providerId)
}

/** Luật family theo id cho provider không có bản dựng sẵn và không tự khai `family`. */
export function providerFamilyFromId(providerId: string): ProviderFamily {
  if (providerId === 'console-command') return 'console-command'
  if (providerId === 'anthropic-api' || providerId.endsWith('-api')) return 'ai-api'
  if (isAgentCliProviderId(providerId)) return 'agent-cli'
  return 'console-command'
}

function requiredFieldDefaults(input: RunnerProvider, base: RegisteredProvider | undefined): Partial<RegisteredProvider> {
  const defaults: Partial<RegisteredProvider> = {}
  if (input.family === undefined) defaults.family = base?.family ?? providerFamilyFromId(input.providerId)
  if (input.acceptsAgent === undefined) defaults.acceptsAgent = base?.acceptsAgent ?? true
  if (input.mcpDelivery === undefined) defaults.mcpDelivery = new NoMcpDelivery()
  return defaults
}

function builtinFieldDefaults(input: RunnerProvider, base: RegisteredProvider): Partial<RegisteredProvider> {
  const defaults: Partial<RegisteredProvider> = {}
  if (input.transcriptFormat === undefined && base.transcriptFormat) defaults.transcriptFormat = base.transcriptFormat
  if (input.catalog === undefined && base.catalog) defaults.catalog = base.catalog
  if (!input.captureUsage && base.captureUsage) defaults.captureUsage = base.captureUsage.bind(base)
  if (!input.listModels && base.listModels && base.catalog?.modelListing === 'static') {
    defaults.listModels = base.listModels.bind(base)
  }
  return defaults
}

// xem docs/architecture/code/runner.md §4
function withDefaults(input: RunnerProvider): RegisteredProvider {
  const base = builtins.get(input.providerId)
  const defaults = requiredFieldDefaults(input, base)
  if (base && base !== input) Object.assign(defaults, builtinFieldDefaults(input, base))
  if (!Object.keys(defaults).length) return input as RegisteredProvider
  return new Proxy(input, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target)
      return value === undefined && prop in defaults ? defaults[prop as keyof RegisteredProvider] : value
    },
    has(target, prop) {
      return prop in target || prop in defaults
    },
  }) as RegisteredProvider
}

/** Register (or replace) a provider at runtime; missing fields are filled in by `withDefaults`. */
export function registerProvider(provider: RunnerProvider): void {
  providers.set(provider.providerId, withDefaults(provider))
}

export function getProvider(providerId: string): RegisteredProvider | null {
  return providers.get(providerId) || null
}

export function listProviderIds(): string[] {
  return [...providers.keys()]
}

/** Family của provider: bản dựng sẵn → provider đang chạy → luật theo id. */
export function providerFamilyOf(providerId: string): ProviderFamily {
  return builtins.get(providerId)?.family ?? providers.get(providerId)?.family ?? providerFamilyFromId(providerId)
}

/** Định dạng transcript — cùng thứ tự fallback với `providerFamilyOf`; id lạ họ `ai-api` ⇒ `agent-sdk`, còn lại ⇒ `none`. */
export function transcriptFormatOf(providerId: string): TranscriptFormat {
  return (
    builtins.get(providerId)?.transcriptFormat ??
    providers.get(providerId)?.transcriptFormat ??
    (providerFamilyFromId(providerId) === 'ai-api' ? 'agent-sdk' : 'none')
  )
}

function describe(provider: RegisteredProvider): ProviderDescriptor | null {
  if (!provider.catalog) return null
  return {
    id: provider.providerId,
    ...provider.catalog,
    family: provider.family,
    acceptsAgent: provider.acceptsAgent,
    ...(provider.transcriptFormat ? { transcriptFormat: provider.transcriptFormat } : {}),
  }
}

/** Mô tả provider (nhãn, kind, lệnh CLI…) — bản dựng sẵn trước, rồi provider đang chạy. */
export function providerDescriptorOf(providerId: string): ProviderDescriptor | null {
  const provider = builtins.get(providerId) ?? providers.get(providerId)
  return provider ? describe(provider) : null
}

/** Catalog provider cho UI; `mcpDelivery` lấy từ delivery đã lắp ráp vào provider đang chạy. */
export function listProviderCatalog(): ProviderCatalogEntry[] {
  const out: ProviderCatalogEntry[] = []
  const seen = new Set<string>()
  const push = (descriptor: ProviderDescriptor | null) => {
    if (!descriptor || seen.has(descriptor.id)) return
    seen.add(descriptor.id)
    const delivery: McpDelivery = providers.get(descriptor.id)?.mcpDelivery?.kind ?? 'unsupported'
    out.push({ ...descriptor, mcpDelivery: delivery })
  }
  for (const provider of builtins.values()) push(describe(provider))
  for (const provider of providers.values()) push(describe(provider))
  return out
}

/** Lệnh CLI cục bộ đã biết (scan PATH) — theo thứ tự catalog. */
export function listLocalCommands(): Array<{ id: string; command: string; providerId: string; label: string }> {
  return listProviderCatalog()
    .filter((e) => e.localCommand)
    .map((e) => ({ id: e.localCommand!.id, command: e.localCommand!.command, providerId: e.id, label: e.label }))
}

// xem docs/mcp/client.md §7
/** Dọn dấu vết giao MCP mồ côi lúc bootstrap — một lượt cho mỗi `kind`. */
export function cleanupOrphanedMcpDeliveries(): void {
  const done = new Set<McpDelivery>()
  for (const provider of providers.values()) {
    const delivery = provider.mcpDelivery
    if (!delivery || done.has(delivery.kind)) continue
    done.add(delivery.kind)
    delivery.cleanupOrphans()
  }
}
