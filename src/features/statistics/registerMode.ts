import type { ModeRegistry, ShellContext } from '../../core/shell/modeRegistry'
import StatisticsPanel from './components/StatisticsPanel.vue'

export function registerStatisticsMode(registry: ModeRegistry): void {
  registry.registerMode({
    key: 'statistics',
    labelKey: 'common.modes.statistics',
    icon: 'statistics',
    order: 9,
    statusKind: 'paused',
    panel: StatisticsPanel,
    bindings: (ctx: ShellContext) => {
      const c = ctx as Record<string, unknown>
      return { projectId: c.selectedProjectId, defaultProjectId: c.defaultProjectId }
    },
  })
}
