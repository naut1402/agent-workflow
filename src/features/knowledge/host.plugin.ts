import type { DashboardPlugin } from '@shared/host/contract'
import type { HostContext } from '../../shared/host/hostContext'
import KnowledgePanel from './components/KnowledgePanel.vue'
import { knowledgeApi } from './api'

/** Thin registration wrapper — no change to `KnowledgePanel.vue` itself. */
export const knowledgePlugin: DashboardPlugin<HostContext> = {
  id: 'knowledge',
  activate(ctx) {
    ctx.registerMode({
      id: 'knowledge',
      labelKey: 'common.modes.knowledge',
      icon: 'knowledge',
      entry: KnowledgePanel,
      pausedStatusKey: 'common.status.paused.knowledge',
    })
    ctx.api.register('knowledge', knowledgeApi)
  },
}
