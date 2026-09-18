import type { ModeRegistry, ShellContext } from '../../frontend/shell/modeRegistry'
import { subSidebarBindings } from '../../frontend/shell/subSidebarBindings'
import AgentEditor from './components/AgentEditor.vue'

export function registerMode(registry: ModeRegistry): void {
  registry.registerMode({
    key: 'agentEditor',
    labelKey: 'common.modes.agentEditor',
    icon: 'agent',
    order: 3,
    panel: AgentEditor,
    descriptionKey: 'common.modeDesc.agentEditor',
    maturity: 'stable',
    defaultEnabled: true,
    subSidebar: { persistKey: 'dev-dashboard-agent-editor-subsidebar-collapsed' },
    bindings: (ctx: ShellContext) => ({
      projectId: (ctx as Record<string, unknown>).selectedProjectId,
      ...subSidebarBindings(ctx, 'agentEditor'),
    }),
  })
}
