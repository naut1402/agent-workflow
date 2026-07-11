import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import { useAppSettings } from './shared/composables/useAppSettings'
import { applyThemeToDocument, watchSystemTheme } from './shared/lib/theme'
import { resolveThemePreference } from '../shared/schemas/appSettings'

const { settings, load } = useAppSettings()
load()

watchSystemTheme(() => {
  if (resolveThemePreference(settings.value) === 'system') {
    applyThemeToDocument('system')
  }
})

createApp(App).mount('#app')
