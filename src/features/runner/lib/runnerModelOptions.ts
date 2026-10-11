import type { ConnectionOption, ProviderEntry, ProviderFamily, RunnerDraft } from '../types'
import { providerEntryOf } from './providerCatalog'

/** Option khớp `CSelectOption` mà không phải kéo component vào lib. */
export type RunnerModelOption = { value: string; label: string }

/** Chỉ cần đủ field lib này đọc — response thật mang nhiều hơn. */
export type RunnerCatalogLike = {
  runners?: Partial<RunnerDraft>[] | null
  connections?: ConnectionOption[] | null
  providers?: ProviderEntry[] | null
} | null | undefined

const LEGACY_AGENT_CLI_PROVIDER_IDS = ['claude-code-cli', 'cursor-cli', 'codex-cli']

/** Bản FE của `providerFamilyOf` (`business/providers/providerRegistry.ts`): catalog trước, quy tắc theo id sau. */
export function familyOfProviderId(
  providerId: string | undefined,
  providers?: ProviderEntry[] | null,
): ProviderFamily {
  if (!providerId) return 'console-command'
  const fromCatalog = providerEntryOf(providerId, providers)?.family
  if (fromCatalog) return fromCatalog
  if (providerId === 'console-command') return 'console-command'
  if (providerId === 'anthropic-api' || providerId.endsWith('-api')) return 'ai-api'
  if (LEGACY_AGENT_CLI_PROVIDER_IDS.includes(providerId)) return 'agent-cli'
  return 'console-command'
}

/**
 * Một option mỗi runner chạy AI được, theo thứ tự `runners[]`. `value` là runner id; nhãn là
 * model của connection (thiếu thì tên runner, trùng model thì nối thêm tên runner).
 */
export function buildRunnerModelOptions(input: RunnerCatalogLike): RunnerModelOption[] {
  const runners = Array.isArray(input?.runners) ? input.runners : []
  const connections = Array.isArray(input?.connections) ? input.connections : []
  const providers = Array.isArray(input?.providers) ? input.providers : []

  const picked: { value: string; label: string; suffix: string }[] = []
  for (const runner of runners) {
    const id = typeof runner?.id === 'string' ? runner.id : ''
    if (!id) continue
    if (runner.enabled === false) continue

    const conn = connections.find((c) => c?.id === runner.connectionId)
    const family = familyOfProviderId(conn?.providerId, providers)
    if (family !== 'agent-cli' && family !== 'ai-api') continue

    const model = conn?.config?.model || conn?.config?.models?.[0]
    const suffix = runner.name || id
    picked.push({ value: id, label: String(model || suffix), suffix })
  }

  const seen = new Map<string, number>()
  for (const o of picked) seen.set(o.label, (seen.get(o.label) || 0) + 1)

  return picked.map((o) => ({
    value: o.value,
    label: (seen.get(o.label) || 0) > 1 ? `${o.label} · ${o.suffix}` : o.label,
  }))
}
