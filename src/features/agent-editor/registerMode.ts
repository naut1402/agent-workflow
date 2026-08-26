import type { ModeRegistry, ShellContext } from '../../core/shell/modeRegistry'
import AgentEditor from './components/AgentEditor.vue'

export function registerAgentEditorMode(registry: ModeRegistry): void {
  registry.registerMode({
    key: 'agentEditor',
    labelKey: 'common.modes.agentEditor',
    icon: 'agent',
    order: 3,
    statusKind: 'paused',
    panel: AgentEditor,
    bindings: (ctx: ShellContext) => ({
      projectId: (ctx as Record<string, unknown>).selectedProjectId,
    }),
  })
}
