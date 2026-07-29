import type { DashboardPlugin } from '@shared/host/contract'
import type { HostContext } from '../../shared/host/hostContext'
import FloatingNotificationIcon from './components/FloatingNotificationIcon.vue'
import { notifications as viNotifications } from '../../shared/i18n/locales/vi/notifications'
import { notifications as enNotifications } from '../../shared/i18n/locales/en/notifications'

/**
 * Smoke sample #2 for the HostContext seam (issue #159, `registerFloating`).
 * `i18n.merge` call below is the first real consumer of that seam (E0004-02,
 * Việc 2+) — the namespace also stays declared in `locales/{vi,en}/index.ts`
 * for the compile-time `Messages` schema (see hostContext.ts `i18n.merge` doc).
 */
export const notificationsPlugin: DashboardPlugin<HostContext> = {
  id: 'notifications',
  activate(ctx) {
    ctx.registerFloating({
      id: 'notifications',
      entry: FloatingNotificationIcon,
    })
    ctx.i18n.merge('vi', 'notifications', viNotifications)
    ctx.i18n.merge('en', 'notifications', enNotifications)
  },
}
