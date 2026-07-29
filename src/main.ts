import { createApp } from 'vue'
import App from './App.vue'
import './styles/main.scss'
import { useAppSettings } from './shared/composables/useAppSettings'
import { applyThemeToDocument, watchSystemTheme } from './shared/lib/theme'
import { resolveThemePreference, resolveLocale } from '../shared/schemas/appSettings'
import { i18n, setI18nLocale } from './shared/i18n'
import { HostPlugin } from './shared/host/vuePlugin'
import { BUILTIN_PLUGINS } from './bootstrap/builtinPlugins'

const { settings, load } = useAppSettings()
load()
setI18nLocale(resolveLocale(settings.value))

watchSystemTheme(() => {
  if (resolveThemePreference(settings.value) === 'system') {
    applyThemeToDocument('system')
  }
})

createApp(App).use(i18n).use(HostPlugin, { plugins: BUILTIN_PLUGINS }).mount('#app')
