import type { ModeRegistry, ShellContext } from '../../core/shell/modeRegistry'
import KnowledgePanel from './components/KnowledgePanel.vue'

export function registerMode(registry: ModeRegistry): void {
  registry.registerMode({
    key: 'knowledge',
    labelKey: 'common.modes.knowledge',
    icon: 'knowledge',
    order: 5,
    statusKind: 'paused',
    panel: KnowledgePanel,
    bindings: (ctx: ShellContext) => ({
      projectId: (ctx as Record<string, unknown>).selectedProjectId,
    }),
  })
}
