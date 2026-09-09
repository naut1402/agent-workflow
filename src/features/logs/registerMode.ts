import type { ModeRegistry, ShellContext } from '../../core/shell/modeRegistry'
import LogsPanel from './components/LogsPanel.vue'

export function registerMode(registry: ModeRegistry): void {
  registry.registerMode({
    key: 'logs',
    labelKey: 'common.modes.logs',
    icon: 'logs',
    order: 8,
    statusKind: 'paused',
    panel: LogsPanel,
    // Tab Logs có thể bị ẩn qua Settings (`showLogsTab`) — giữ đúng hành vi gốc
    // (nút chỉ hiện khi bật), không lộ ra sidebar khi tắt.
    visible: (ctx: ShellContext) => Boolean((ctx as Record<string, unknown>).showLogsTab),
  })
}
