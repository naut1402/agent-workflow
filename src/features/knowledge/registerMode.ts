import type { ModeRegistry, ShellContext } from '../../frontend/shell/modeRegistry'
import KnowledgePanel from './components/KnowledgePanel.vue'

export function registerMode(registry: ModeRegistry): void {
  registry.registerMode({
    key: 'knowledge',
    labelKey: 'common.modes.knowledge',
    icon: 'knowledge',
    order: 5,
    statusKind: 'paused',
    panel: KnowledgePanel,
    descriptionKey: 'common.modeDesc.knowledge',
    maturity: 'stable',
    defaultEnabled: true,
    bindings: (ctx: ShellContext) => ({
      projectId: (ctx as Record<string, unknown>).selectedProjectId,
    }),
  })
}
