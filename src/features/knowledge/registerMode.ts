import type { ModeRegistry } from '../../core/shell/modeRegistry'
import KnowledgePanel from './components/KnowledgePanel.vue'

export function registerKnowledgeMode(registry: ModeRegistry): void {
  registry.registerMode({
    key: 'knowledge',
    labelKey: 'common.modes.knowledge',
    icon: 'knowledge',
    order: 5,
    statusKind: 'paused',
    panel: KnowledgePanel,
  })
}
