// Chỗ lắp ráp DUY NHẤT của provider runner (composition root): biết hiện thực cụ
// thể, endpoint mặc định, cách giao MCP của từng provider. Caller khác chỉ biết
// `RunnerProvider` qua các hàm tra cứu bên dưới.
//
// Thêm provider = một file hiện thực + một dòng `builtin(...)` ở đây.

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

/** Provider dựng sẵn — bảng tra tĩnh, 🚫 đổi khi test thay provider đang chạy. */
const builtins = new Map<string, RegisteredProvider>()
/** Provider đang chạy cho từng id — ban đầu chính là bản dựng sẵn. */
const providers = new Map<string, RegisteredProvider>()

function builtin(provider: RegisteredProvider): void {
  builtins.set(provider.providerId, provider)
  providers.set(provider.providerId, provider)
}

// ── Lắp ráp cách giao MCP ──────────────────────────────────────────────────
// Chỗ DUY NHẤT biết provider nào nhận MCP bằng cách nào. Provider không được
// truyền delivery (codex, console ⇒ `NoMcpDelivery`) không nhận MCP.
//
// Một adapter credential dùng chung: cả ba cách giao giải `credentialId` của
// server từ xa giống hệt nhau.
const mcpCredentials = new RunnerCredentialResolver()
/** File cấu hình job (claude) và ledger workspace (cursor) — 🚫 trong workspace người dùng. */
const mcpRuntimeDir = () => joinPath(registryHome(), 'mcp-runtime')
const mcpToolBridge = new ToolBridgeMcpDelivery(mcpCredentials)

// ── Adapter runner cắm vào cổng của feature khác ───────────────────────────
// Feature kia khai cổng + `use…()`, runner đăng ký hiện thực ở đây lúc nạp
// module — feature kia 🚫 import runner (cạnh ngược là vòng import).
//
// Cùng instance cho caller không nhận resolver qua tham số (`mcp/controller.ts`
// lấy lại bằng `credentialResolver()`).
useCredentialResolver(mcpCredentials)
// #448: adapter sinh bản nháp agent (cổng `DraftCompletion` của agent-editor)
// đăng ký tại đây, gọi hook `RunnerProvider.complete()` của Connection ai-api.

// ── Provider dựng sẵn — thứ tự = thứ tự catalog UI ─────────────────────────
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

/** Built-in Agent CLI provider ids — suy từ provider dựng sẵn, 🚫 danh sách viết tay. */
export const AGENT_CLI_PROVIDER_IDS: readonly string[] = [...builtins.values()]
  .filter((p) => p.family === 'agent-cli')
  .map((p) => p.providerId)

export function isAgentCliProviderId(providerId: string): boolean {
  return AGENT_CLI_PROVIDER_IDS.includes(providerId)
}

/**
 * Luật family theo id cho provider KHÔNG có bản dựng sẵn và không tự khai
 * `family` (stub test, provider lạ): giữ nguyên luật cũ để hành vi không đổi.
 */
export function providerFamilyFromId(providerId: string): ProviderFamily {
  if (providerId === 'console-command') return 'console-command'
  if (providerId === 'anthropic-api' || providerId.endsWith('-api')) return 'ai-api'
  if (isAgentCliProviderId(providerId)) return 'agent-cli'
  return 'console-command'
}

/**
 * Bù trường provider không khai. Ưu tiên bản dựng sẵn cùng id (stub test thay
 * `claude-code-cli` vẫn được ghi usage transcript, liệt kê model tĩnh như
 * trước), rồi mới tới luật theo id.
 *
 * 🚫 Ghi lên object được đăng ký: test hay dựng stub thứ hai bằng
 * `{ ...stub, providerId: 'khac' }`, ghi thẳng thì stub sau chép luôn `family`
 * suy theo id của stub trước. Giá trị bù nằm trong Proxy — đọc rơi về nó khi
 * object không khai, ghi vẫn đi thẳng xuống object gốc.
 */
function withDefaults(input: RunnerProvider): RegisteredProvider {
  const base = builtins.get(input.providerId)
  const defaults: Partial<RegisteredProvider> = {}
  if (input.family === undefined) defaults.family = base?.family ?? providerFamilyFromId(input.providerId)
  if (input.acceptsAgent === undefined) defaults.acceptsAgent = base?.acceptsAgent ?? true
  if (input.mcpDelivery === undefined) defaults.mcpDelivery = new NoMcpDelivery()
  if (base && base !== input) {
    if (input.transcriptFormat === undefined && base.transcriptFormat) defaults.transcriptFormat = base.transcriptFormat
    if (input.catalog === undefined && base.catalog) defaults.catalog = base.catalog
    if (!input.captureUsage && base.captureUsage) defaults.captureUsage = base.captureUsage.bind(base)
    // Chỉ danh sách tĩnh: provider API thay thế phải tự gọi được endpoint của nó.
    if (!input.listModels && base.listModels && base.catalog?.modelListing === 'static') {
      defaults.listModels = base.listModels.bind(base)
    }
  }
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

/**
 * Register (or replace) a provider at runtime. Built-in providers are registered
 * at module load; this is the seam tests use to inject a stub provider (e.g. an
 * approval-flow provider that writes a proposed edit into the scratch workspace
 * without spawning a real CLI). Trường thiếu được bù — xem `withDefaults`.
 */
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

/**
 * Định dạng transcript provider để lại — cùng thứ tự fallback với
 * `providerFamilyOf`. Provider lạ họ `ai-api` ⇒ `agent-sdk` (runner tự ghi cho
 * mọi `AgenticApiProvider`); còn lại ⇒ `none`.
 */
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

/**
 * Catalog provider cho UI. `mcpDelivery` lấy thẳng từ delivery đã lắp ráp vào
 * provider đang chạy — 🚫 bảng tra riêng theo `providerId`, nên catalog không
 * lệch được khỏi thứ job thật sự nhận.
 */
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

/**
 * Dọn dấu vết giao MCP mồ côi lúc bootstrap (tiến trình trước bị kill giữa job):
 * file token plaintext dưới `mcp-runtime/`, `.cursor/mcp.json` trong repo người
 * dùng kèm khoá treo. Một lượt cho mỗi `kind` — nhiều provider dùng chung một
 * cách giao thì dọn chung một lần.
 */
export function cleanupOrphanedMcpDeliveries(): void {
  const done = new Set<McpDelivery>()
  for (const provider of providers.values()) {
    const delivery = provider.mcpDelivery
    if (!delivery || done.has(delivery.kind)) continue
    done.add(delivery.kind)
    delivery.cleanupOrphans()
  }
}
