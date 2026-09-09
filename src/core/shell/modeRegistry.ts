import type { Component } from 'vue'
import { createToken, type ContainerToken } from '../container'
import type { RailIconName } from '../ui/railIconNames'

/** Object App.vue dựng mỗi render — state/hàm shell sở hữu mà mode cần đọc/gọi. */
export type ShellContext = Record<string, unknown>

export interface ModeEntry {
  key: string
  labelKey: string
  /** Tooltip riêng (khác `labelKey`) — mặc định dùng `labelKey` nếu không set. */
  titleKey?: string
  icon: RailIconName
  order: number
  statusKind: 'live' | 'paused'
  panel: Component
  /** Ẩn mode khỏi sidebar/status/main khi false (vd `logs` theo `showLogsTab`). Mặc định luôn hiện. */
  visible?: (ctx: ShellContext) => boolean
  /**
   * Mode có sub-sidebar thu/phóng được. Có khai = click lại mode icon đang active
   * sẽ toggle sub-sidebar; không khai = click lại là no-op.
   * `persistKey`: localStorage key lưu trạng thái; bỏ trống = không persist.
   */
  subSidebar?: { persistKey?: string }
  /** Props + `onXxx` listeners truyền cho `panel`. Optional cho mode 0 props. */
  bindings?: (ctx: ShellContext) => Record<string, unknown>
}

export interface ModeRegistry {
  /** Throw nếu `key` đã được đăng ký. */
  registerMode(entry: ModeEntry): void
  /** Sort theo `order` tăng dần. */
  listModes(): ModeEntry[]
  getMode(key: string): ModeEntry | undefined
}

export function createModeRegistry(): ModeRegistry {
  const modes = new Map<string, ModeEntry>()

  return {
    registerMode(entry) {
      if (modes.has(entry.key)) {
        throw new Error(`ModeRegistry: mode "${entry.key}" đã được đăng ký`)
      }
      modes.set(entry.key, entry)
    },
    listModes() {
      return [...modes.values()].sort((a, b) => a.order - b.order)
    },
    getMode(key) {
      return modes.get(key)
    },
  }
}

export const modeRegistryToken: ContainerToken<ModeRegistry> = createToken<ModeRegistry>('modeRegistry')
