import type { DashboardPlugin } from '@shared/host/contract'
import type { HostContext } from '../../shared/host/hostContext'
import LogsPanel from './components/LogsPanel.vue'
import { logsApi } from './api'

/** Thin registration wrapper — no change to `LogsPanel.vue` itself. */
export const logsPlugin: DashboardPlugin<HostContext> = {
  id: 'logs',
  activate(ctx) {
    ctx.registerMode({
      id: 'logs',
      labelKey: 'common.modes.logs',
      icon: 'logs',
      entry: LogsPanel,
      pausedStatusKey: 'common.status.paused.logs',
    })
    ctx.api.register('logs', logsApi)
  },
}
