import { createApp } from 'vue'
import App from './App.vue'
import './styles/main.scss'
// Auto-load features/<name>/styles/index.scss — new features need no main.scss edit.
import.meta.glob('./features/*/styles/index.scss', { eager: true })
import { useAppSettings } from './core/composables/useAppSettings'
import { applyThemeToDocument, watchSystemTheme } from './core/lib/theme'
import { resolveThemePreference, resolveLocale } from './core/configs/appSettings'
import { installPlugins, setI18nLocale } from './plugins'

const { settings, load } = useAppSettings()
load()
const locale = resolveLocale(settings.value)
setI18nLocale(locale)

watchSystemTheme(() => {
  if (resolveThemePreference(settings.value) === 'system') {
    applyThemeToDocument('system')
  }
})

installPlugins(createApp(App), { i18n: { locale } }).mount('#app')
