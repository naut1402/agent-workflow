import { createApp } from 'vue'
import App from './App.vue'
import './styles/main.scss'
import.meta.glob('../features/*/styles/index.scss', { eager: true })
import { useAppSettings } from './composables/useAppSettings'
import { applyThemeToDocument, watchSystemTheme } from './lib/theme'
import { resolveThemePreference, resolveLocale } from './configs/appSettings'
import { installPlugins, setI18nLocale } from './plugins'
import { createContainer } from './container'
import { createModeRegistry, modeRegistryToken, type ModeRegistry } from './shell/modeRegistry'
import { modeAccessToken } from './shell/modeAccess'
import { createSettingsModeAccess } from '../features/settings/scripts/settingsModeAccess'

const { settings, load } = useAppSettings()
load()
const locale = resolveLocale(settings.value)
setI18nLocale(locale)

watchSystemTheme(() => {
  if (resolveThemePreference(settings.value) === 'system') {
    applyThemeToDocument('system')
  }
})

const modeModules = import.meta.glob('../features/*/registerMode.ts', { eager: true })

const modeRegistry = createModeRegistry()
for (const mod of Object.values(modeModules)) {
  ;(mod as { registerMode: (registry: ModeRegistry) => void }).registerMode(modeRegistry)
}

const container = createContainer()
container.register(modeRegistryToken, () => modeRegistry)
// xem docs/agent-rules/mode-registry-guideline.md §7
const modeAccess = createSettingsModeAccess(modeRegistry)
container.register(modeAccessToken, () => modeAccess)

installPlugins(createApp(App), { i18n: { locale }, container }).mount('#app')
