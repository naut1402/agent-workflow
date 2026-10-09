import type { ModeRegistry } from '../../frontend/shell/modeRegistry'
import RunnerConfigPanel from './components/RunnerConfigPanel.vue'

export function registerMode(registry: ModeRegistry): void {
  registry.registerMode({
    key: 'runner',
    labelKey: 'common.modes.runner',
    titleKey: 'common.modes.runnerConfig',
    icon: 'runner',
    order: 6,
    panel: RunnerConfigPanel,
    descriptionKey: 'common.modeDesc.runner',
    maturity: 'stable',
    defaultEnabled: true,
  })
}
