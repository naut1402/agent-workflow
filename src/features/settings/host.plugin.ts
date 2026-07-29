import type { DashboardPlugin } from '@shared/host/contract'
import type { HostContext } from '../../shared/host/hostContext'
import SettingsDialog from './components/SettingsDialog.vue'
import { settingsApi } from './api'

/**
 * `settings` was left unregistered in E0004-01 (Việc 1) — the trigger button
 * lives in the rail sidebar, not as a page-level floating icon, so it needed
 * the new `registerRailAction` seam (see design.md E0004-02 §3.3) rather than
 * `registerFloating`.
 */
export const settingsPlugin: DashboardPlugin<HostContext> = {
  id: 'settings',
  activate(ctx) {
    ctx.registerRailAction({
      id: 'settings',
      labelKey: 'common.sidebar.settings',
      icon: 'settings',
      entry: SettingsDialog,
    })
    ctx.api.register('settings', settingsApi)
  },
}
