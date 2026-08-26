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
import { createModeRegistry, modeRegistryToken } from './core/shell/modeRegistry'
import { registerMonitorMode } from './features/monitor/registerMode'
import { registerPipelineEditorMode } from './features/pipeline-editor/registerMode'
import { registerAgentEditorMode } from './features/agent-editor/registerMode'
import { registerQuickActionMode } from './features/quick-action/registerMode'
import { registerKnowledgeMode } from './features/knowledge/registerMode'
import { registerRunnerMode } from './features/runner/registerMode'
import { registerAutomationsMode } from './features/automations/registerMode'
import { registerLogsMode } from './features/logs/registerMode'
import { registerStatisticsMode } from './features/statistics/registerMode'

const { settings, load } = useAppSettings()
load()
const locale = resolveLocale(settings.value)
setI18nLocale(locale)

watchSystemTheme(() => {
  if (resolveThemePreference(settings.value) === 'system') {
    applyThemeToDocument('system')
  }
})

// Đăng ký tường minh + đồng bộ, trước app.mount() — đảm bảo App.vue đọc
// registry lần đầu (trong setup) không bị thiếu mode nào.
const modeRegistry = createModeRegistry()
registerMonitorMode(modeRegistry)
registerPipelineEditorMode(modeRegistry)
registerAgentEditorMode(modeRegistry)
registerQuickActionMode(modeRegistry)
registerKnowledgeMode(modeRegistry)
registerRunnerMode(modeRegistry)
registerAutomationsMode(modeRegistry)
registerLogsMode(modeRegistry)
registerStatisticsMode(modeRegistry)

const container = createContainer()
container.register(modeRegistryToken, () => modeRegistry)

installPlugins(createApp(App), { i18n: { locale }, container }).mount('#app')
