import { ref } from 'vue'
import { isEnabledByDefault, type ModeAccessProvider } from '../../../frontend/shell/modeAccess'
import type { ModeRegistry } from '../../../frontend/shell/modeRegistry'
import { parseModesConfig, resolveModeEnabled, type ModesConfig } from '../schemas/modes'
import { fetchModesConfig } from './SettingsDialogApi'

/**
 * Nguồn: setting toàn cục trong settings.json.
 * xem docs/agent-rules/mode-registry-guideline.md §7
 */
export function createSettingsModeAccess(registry: ModeRegistry): ModeAccessProvider {
  const config = ref<ModesConfig | null>(null)

  function canAccessMode(modeKey: string): boolean {
    const entry = registry.getMode(modeKey)
    if (!entry) return false
    if (entry.alwaysOn) return true
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
