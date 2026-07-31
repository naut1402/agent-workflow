import { createApp } from 'vue'
import App from './App.vue'
import './styles/main.scss'
import { useAppSettings } from './core/composables/useAppSettings'
import { applyThemeToDocument, watchSystemTheme } from './core/lib/theme'
import { resolveThemePreference, resolveLocale } from './core/contracts/schemas/appSettings'
import { i18n, setI18nLocale } from './core/i18n'

const { settings, load } = useAppSettings()
load()
setI18nLocale(resolveLocale(settings.value))

watchSystemTheme(() => {
  if (resolveThemePreference(settings.value) === 'system') {
    applyThemeToDocument('system')
  }
})

createApp(App).use(i18n).mount('#app')
