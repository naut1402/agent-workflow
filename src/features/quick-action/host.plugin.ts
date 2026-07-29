import type { DashboardPlugin } from '@shared/host/contract'
import type { HostContext } from '../../shared/host/hostContext'
import QuickActionPanel from './components/QuickActionPanel.vue'

/** Thin registration wrapper — no change to `QuickActionPanel.vue` itself. */
export const quickActionPlugin: DashboardPlugin<HostContext> = {
  id: 'quick-action',
  activate(ctx) {
    ctx.registerMode({
      id: 'quickAction',
      labelKey: 'common.modes.quickAction',
      icon: 'quickAction',
      entry: QuickActionPanel,
      pausedStatusKey: 'common.status.paused.quickAction',
    })
  },
}
