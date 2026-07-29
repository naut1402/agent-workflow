import type { DashboardPlugin } from '@shared/host/contract'
import type { HostContext } from '../../shared/host/hostContext'
import MonitorLayout from './components/MonitorLayout.vue'

/** Smoke sample #1 for the HostContext seam (issue #159, `registerMode`). */
export const monitorPlugin: DashboardPlugin<HostContext> = {
  id: 'monitor',
  activate(ctx) {
    ctx.registerMode({
      id: 'monitor',
      labelKey: 'common.modes.monitor',
      icon: 'monitor',
      entry: MonitorLayout,
      default: true,
    })
  },
}
