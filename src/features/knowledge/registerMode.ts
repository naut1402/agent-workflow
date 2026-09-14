import type { ModeRegistry, ShellContext } from '../../frontend/shell/modeRegistry'
import { subSidebarBindings } from '../../frontend/shell/subSidebarBindings'
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
    subSidebar: { persistKey: 'dev-dashboard-knowledge-subsidebar-collapsed' },
    bindings: (ctx: ShellContext) => ({
      projectId: (ctx as Record<string, unknown>).selectedProjectId,
      ...subSidebarBindings(ctx, 'knowledge'),
    }),
  })
}
