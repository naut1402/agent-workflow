import type { DashboardPlugin } from '@shared/host/contract'
import type { HostContext } from '../../shared/host/hostContext'
import RunnerConfigPanel from './components/RunnerConfigPanel.vue'
import { runnerApi } from './api'

/** Thin registration wrapper — no change to `RunnerConfigPanel.vue` itself. */
export const runnerPlugin: DashboardPlugin<HostContext> = {
  id: 'runner',
  activate(ctx) {
    ctx.registerMode({
      id: 'runner',
      labelKey: 'common.modes.runner',
      titleKey: 'common.modes.runnerConfig',
      icon: 'runner',
      entry: RunnerConfigPanel,
      pausedStatusKey: 'common.status.paused.runner',
    })
    ctx.api.register('runner', runnerApi)
  },
}
