import type { ModeRegistry, ShellContext } from '../../core/shell/modeRegistry'
import QuickActionPanel from './components/QuickActionPanel.vue'

export function registerMode(registry: ModeRegistry): void {
  registry.registerMode({
    key: 'quickAction',
    labelKey: 'common.modes.quickAction',
    icon: 'quickAction',
    order: 4,
    statusKind: 'paused',
    panel: QuickActionPanel,
    bindings: (ctx: ShellContext) => ({
      projectId: (ctx as Record<string, unknown>).selectedProjectId,
    }),
  })
}
