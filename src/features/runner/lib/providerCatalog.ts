/**
 * Tra catalog provider phía FE — UI hỏi provider "làm được gì" qua các trường
 * `ProviderEntry` BE trả kèm (`ProviderDescriptor`), 🚫 tự rẽ nhánh theo
 * `providerId` trong component.
 *
 * Dự phòng giai đoạn chuyển: response / fixture cũ chưa mang trường descriptor
 * thì rơi về luật theo id dưới đây (cùng giá trị BE khai cho 8 provider dựng
 * sẵn), để hành vi không đổi. Provider mới chỉ cần khai descriptor ở BE.
 *
 * Lib FE thuần (không gọi API) — `docs/agent-rules/coding-guideline.md` §5.
 */

import type { ProviderEntry } from '../types'
import { DEFAULT_BASE_URLS, DEFAULT_MODEL_HINTS, DEFAULT_SECRET_ENV_HINTS } from '../scripts/agenticProviderDefaults'

type Providers = ProviderEntry[] | null | undefined

export function providerEntryOf(providerId: string | undefined | null, providers?: Providers): ProviderEntry | null {
  if (!providerId) return null
  return (providers || []).find((p) => p?.id === providerId) || null
}

// ── Dự phòng theo id (catalog thiếu trường) ────────────────────────────────
const LEGACY_STATIC_MODEL_IDS = ['claude-code-cli']
const LEGACY_ALLOWED_TOOLS_IDS = ['claude-code-cli']
const LEGACY_NO_AGENT_IDS = ['console-command']
const LEGACY_LOCAL_COMMANDS: Array<{ providerId: string; base: string; path?: string }> = [
  { providerId: 'claude-code-cli', base: '^claude$' },
  { providerId: 'cursor-cli', base: '^(agent|cursor-agent)$', path: 'cursor-agent' },
  { providerId: 'codex-cli', base: 'codex' },
]

/** Provider có chạy agent không — `false` với lệnh console (prompt là argv). */
export function acceptsAgentOf(providerId: string | undefined | null, providers?: Providers): boolean {
  const declared = providerEntryOf(providerId, providers)?.acceptsAgent
  if (declared !== undefined) return declared
  return !LEGACY_NO_AGENT_IDS.includes(providerId || '')
}

/** Danh sách model cố định, tải không cần credential (ô chọn model cho CLI cục bộ). */
export function hasStaticModelsOf(providerId: string | undefined | null, providers?: Providers): boolean {
  const declared = providerEntryOf(providerId, providers)?.modelListing
  if (declared !== undefined) return declared === 'static'
  return LEGACY_STATIC_MODEL_IDS.includes(providerId || '')
}

/** Provider hiểu `allowedTools`. */
export function supportsAllowedToolsOf(providerId: string | undefined | null, providers?: Providers): boolean {
  const entry = providerEntryOf(providerId, providers)
  if (entry?.modelListing !== undefined || entry?.supportsAllowedTools !== undefined) {
    return entry.supportsAllowedTools === true
  }
  return LEGACY_ALLOWED_TOOLS_IDS.includes(providerId || '')
}

export function defaultBaseUrlOf(providerId: string | undefined | null, providers?: Providers): string {
  return providerEntryOf(providerId, providers)?.defaultBaseURL || DEFAULT_BASE_URLS[providerId || ''] || ''
}

export function modelHintOf(providerId: string | undefined | null, providers?: Providers): string {
  return providerEntryOf(providerId, providers)?.modelHint || DEFAULT_MODEL_HINTS[providerId || ''] || ''
}

export function secretEnvHintOf(providerId: string | undefined | null, providers?: Providers): string {
  return providerEntryOf(providerId, providers)?.secretEnvHint || DEFAULT_SECRET_ENV_HINTS[providerId || ''] || ''
}

/**
 * Suy provider từ đường dẫn / tên lệnh CLI: tên file (bỏ đuôi
 * `.exe/.cmd/.bat/.ps1`) khớp `localCommand.match.base`, hoặc cả đường dẫn khớp
 * `localCommand.match.path`. Duyệt theo thứ tự catalog; không khớp ⇒ `null`.
 */
export function inferProviderIdFromCommand(pathOrCmd: string, providers?: Providers): string | null {
  const base =
    pathOrCmd
      .replace(/\\/g, '/')
      .split('/')
      .pop()
      ?.replace(/\.(exe|cmd|bat|ps1)$/i, '') || ''
  const declared = (providers || [])
    .filter((p) => p?.localCommand?.match)
    .map((p) => ({ providerId: p.id, ...p.localCommand!.match }))
  for (const m of declared.length ? declared : LEGACY_LOCAL_COMMANDS) {
    if (new RegExp(m.base, 'i').test(base)) return m.providerId
    if (m.path && new RegExp(m.path, 'i').test(pathOrCmd)) return m.providerId
  }
  return null
}
