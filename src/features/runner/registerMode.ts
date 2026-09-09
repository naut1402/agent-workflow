import type { ModeRegistry } from '../../core/shell/modeRegistry'
import RunnerConfigPanel from './components/RunnerConfigPanel.vue'

export function registerMode(registry: ModeRegistry): void {
  registry.registerMode({
    key: 'runner',
    // Tooltip ("Runner Config") khác label sidebar ("Runner") — giữ đúng hành vi gốc.
    labelKey: 'common.modes.runner',
    titleKey: 'common.modes.runnerConfig',
    icon: 'runner',
    order: 6,
    statusKind: 'paused',
    panel: RunnerConfigPanel,
  })
}
