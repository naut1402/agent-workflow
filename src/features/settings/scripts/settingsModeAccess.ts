import { ref } from 'vue'
import { isEnabledByDefault, type ModeAccessProvider } from '../../../frontend/shell/modeAccess'
import type { ModeRegistry } from '../../../frontend/shell/modeRegistry'
import { parseModesConfig, resolveModeEnabled, type ModesConfig } from '../schemas/modes'
import { fetchModesConfig } from './SettingsDialogApi'

/**
 * Nguồn hôm nay: setting toàn cục trong settings.json. Đường lên phân quyền theo
 * user trong DB: docs/agent-rules/mode-registry-guideline.md §7.
 */
export function createSettingsModeAccess(registry: ModeRegistry): ModeAccessProvider {
  // null = chưa nạp xong (hoặc nạp lỗi) → mọi mode theo defaultEnabled.
  const config = ref<ModesConfig | null>(null)

  function canAccessMode(modeKey: string): boolean {
    const entry = registry.getMode(modeKey)
    if (!entry) return false
    if (entry.alwaysOn) return true
    // globalEnabled; nhân thêm userPermitted khi có auth — global là điều kiện cần.
    return resolveModeEnabled(config.value, modeKey, isEnabledByDefault(entry))
  }

  return {
    canAccessMode,
    async load() {
      try {
        const data = await fetchModesConfig()
        config.value = parseModesConfig(data.config)
      } catch {
        config.value = null
      }
    },
    applyOverrides(raw) {
      config.value = parseModesConfig(raw)
    },
  }
}
