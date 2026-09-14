import { createToken, type ContainerToken } from '../container'
import type { ModeEntry, ModeRegistry, ShellContext } from './modeRegistry'

/**
 * Lớp "quyết định hiển thị mode", tách khỏi lớp "nguồn cấu hình".
 *
 * Chỉ interface + token nằm ở core; implementation đọc settings.json nằm ở
 * `features/settings/scripts/settingsModeAccess.ts` (core không import xuống
 * features). Đổi nguồn sang role/permission trong DB = đổi 1 dòng
 * `container.register` ở `main.ts` — đường nâng cấp đầy đủ:
 * `docs/agent-rules/mode-registry-guideline.md` §7.
 */

/**
 * Ngữ cảnh quyết định. Hôm nay chỉ có `shell`; provider theo user sẽ đọc thêm
 * `user`. Là object nên thêm field không phá chữ ký của canAccessMode.
 */
export interface ModeAccessContext {
  shell?: ShellContext
  /** Điền khi có auth. Luật kết hợp: docs/agent-rules/mode-registry-guideline.md §7. */
  user?: { id: string; roles: string[] }
}

export interface ModeAccessProvider {
  /** Đồng bộ — computed của shell gọi trong lúc render. */
  canAccessMode(modeKey: string, ctx?: ModeAccessContext): boolean
  /** Nạp cấu hình từ nguồn. Lỗi thì giữ default, không throw. */
  load(): Promise<void>
  /** Áp cấu hình vừa lưu (từ CustomEvent) mà không cần fetch lại. */
  applyOverrides(raw: unknown): void
}

export const modeAccessToken: ContainerToken<ModeAccessProvider> =
  createToken<ModeAccessProvider>('modeAccess')

/** Nguồn duy nhất của quy ước opt-out — provider nào cũng dùng lại. */
export function isEnabledByDefault(entry: ModeEntry | undefined): boolean {
  if (!entry) return false
  return entry.alwaysOn === true || entry.defaultEnabled !== false
}

/** Mọi mode theo `defaultEnabled` của chính nó, không I/O. Dùng cho test/nhúng. */
export function createStaticModeAccess(registry: ModeRegistry): ModeAccessProvider {
  return {
    canAccessMode: (key) => isEnabledByDefault(registry.getMode(key)),
    load: async () => {},
    applyOverrides: () => {},
  }
}
