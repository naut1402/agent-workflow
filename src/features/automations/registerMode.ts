import type { ModeRegistry, ShellContext } from '../../core/shell/modeRegistry'
import AutomationsPanel from './components/AutomationsPanel.vue'

export function registerMode(registry: ModeRegistry): void {
  registry.registerMode({
    key: 'automations',
    labelKey: 'common.modes.automations',
    icon: 'automations',
    order: 7,
    statusKind: 'paused',
    panel: AutomationsPanel,
    bindings: (ctx: ShellContext) => ({
      projectId: (ctx as Record<string, unknown>).selectedProjectId,
    }),
  })
}
