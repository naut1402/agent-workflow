import type { ModeRegistry, ShellContext } from '../../frontend/shell/modeRegistry'
import AutomationsPanel from './components/AutomationsPanel.vue'

export function registerMode(registry: ModeRegistry): void {
  registry.registerMode({
    key: 'automations',
    labelKey: 'common.modes.automations',
    icon: 'automations',
    order: 7,
    statusKind: 'paused',
    panel: AutomationsPanel,
    descriptionKey: 'common.modeDesc.automations',
    maturity: 'stable',
    defaultEnabled: true,
    bindings: (ctx: ShellContext) => ({
      projectId: (ctx as Record<string, unknown>).selectedProjectId,
    }),
  })
}
