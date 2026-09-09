import { createApp } from 'vue'
import App from './App.vue'
import './styles/main.scss'
// Auto-load features/<name>/styles/index.scss — new features need no main.scss edit.
import.meta.glob('./features/*/styles/index.scss', { eager: true })
import { useAppSettings } from './core/composables/useAppSettings'
import { applyThemeToDocument, watchSystemTheme } from './core/lib/theme'
import { resolveThemePreference, resolveLocale } from './core/configs/appSettings'
import { installPlugins, setI18nLocale } from './plugins'
import { createContainer } from './core/container'
import { createModeRegistry, modeRegistryToken, type ModeRegistry } from './core/shell/modeRegistry'

const { settings, load } = useAppSettings()
load()
const locale = resolveLocale(settings.value)
setI18nLocale(locale)

watchSystemTheme(() => {
  if (resolveThemePreference(settings.value) === 'system') {
    applyThemeToDocument('system')
  }
})

// Auto-load features/<name>/registerMode.ts — new features need no main.ts edit,
// chỉ cần thêm file đúng convention (export `registerMode(registry)`). Vite/Vitest
// transform eager glob thành object tĩnh — vẫn đồng bộ, chạy xong trước app.mount().
const modeModules = import.meta.glob('./features/*/registerMode.ts', { eager: true })

const modeRegistry = createModeRegistry()
for (const mod of Object.values(modeModules)) {
  ;(mod as { registerMode: (registry: ModeRegistry) => void }).registerMode(modeRegistry)
}

const container = createContainer()
container.register(modeRegistryToken, () => modeRegistry)

installPlugins(createApp(App), { i18n: { locale }, container }).mount('#app')
