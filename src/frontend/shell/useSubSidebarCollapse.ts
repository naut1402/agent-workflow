import { reactive } from 'vue'
import type { ModeEntry } from './modeRegistry'

/** State ẩn/hiện sub-sidebar theo mode, giữ ở shell vì panel chỉ mount khi mode đang active. */
export interface SubSidebarCollapse {
  /** Mode có sub-sidebar không (mode chưa khai `subSidebar` → false). */
  has(modeKey: string): boolean
  /** true = sub-sidebar của mode đang ẩn. Mode không có sub-sidebar luôn false. */
  isCollapsed(modeKey: string): boolean
  /** Đặt state + persist (nếu mode khai `persistKey`). No-op nếu mode không có sub-sidebar. */
  set(modeKey: string, collapsed: boolean): void
  /** Đảo state. No-op nếu mode không có sub-sidebar. */
  toggle(modeKey: string): void
}

function readPersisted(key?: string): boolean {
  if (!key) return false
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

export function useSubSidebarCollapse(entries: ModeEntry[]): SubSidebarCollapse {
  const persistKeys = new Map<string, string | undefined>()
  const state = reactive<Record<string, boolean>>({})

  for (const e of entries) {
    if (!e.subSidebar) continue
    persistKeys.set(e.key, e.subSidebar.persistKey)
    state[e.key] = readPersisted(e.subSidebar.persistKey)
  }

  function set(modeKey: string, collapsed: boolean) {
    if (!persistKeys.has(modeKey)) return
    state[modeKey] = collapsed
    const key = persistKeys.get(modeKey)
    if (!key) return
    try {
      localStorage.setItem(key, collapsed ? '1' : '0')
    } catch { /* ignore */ }
  }

  return {
    has: (k) => persistKeys.has(k),
    isCollapsed: (k) => state[k] === true,
    set,
    toggle: (k) => set(k, !(state[k] === true)),
  }
}
