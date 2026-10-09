import type { ShellContext } from './modeRegistry'
import type { SubSidebarCollapse } from './useSubSidebarCollapse'

/** Map state sub-sidebar của shell xuống panel dạng `v-model` (prop + `update:` emit). */
export function subSidebarBindings(ctx: ShellContext, modeKey: string): Record<string, unknown> {
  const sub = (ctx as Record<string, unknown>).subSidebar as SubSidebarCollapse
  return {
    subSidebarCollapsed: sub.isCollapsed(modeKey),
    'onUpdate:subSidebarCollapsed': (v: boolean) => sub.set(modeKey, v),
  }
}
