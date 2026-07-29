import type { DashboardPlugin } from '@shared/host/contract'
import type { HostContext } from '../../shared/host/hostContext'
import AgentEditor from './components/AgentEditor.vue'
import { agentEditorApi } from './api'

/** Thin registration wrapper — no change to `AgentEditor.vue` itself. */
export const agentEditorPlugin: DashboardPlugin<HostContext> = {
  id: 'agent-editor',
  activate(ctx) {
    ctx.registerMode({
      id: 'agentEditor',
      labelKey: 'common.modes.agentEditor',
      icon: 'agent',
      entry: AgentEditor,
      pausedStatusKey: 'common.status.paused.agentEditor',
    })
    ctx.api.register('agent-editor', agentEditorApi)
  },
}
