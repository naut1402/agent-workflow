import type { DashboardPlugin } from '@shared/host/contract'
import type { HostContext } from '../../shared/host/hostContext'
import FloatingNotificationIcon from './components/FloatingNotificationIcon.vue'

/** Smoke sample #2 for the HostContext seam (issue #159, `registerFloating`). */
export const notificationsPlugin: DashboardPlugin<HostContext> = {
  id: 'notifications',
  activate(ctx) {
    ctx.registerFloating({
      id: 'notifications',
      entry: FloatingNotificationIcon,
    })
  },
}
