import { getCurrentInstance, type App, type ComponentPublicInstance } from 'vue'
import { i18nPlugin, type I18nPluginOptions } from './i18n'

export type InstallPluginsOptions = {
  i18n?: I18nPluginOptions
}

/**
 * Cài thư viện/plugin app-scope tại một chỗ (i18n, …).
 * Chỉ gọi từ app root (`main.ts`). Feature không import `createI18n` / `vue-i18n`.
 * Sau khi cài: `useApp().$t` / template `$t`.
 */
export function installPlugins(app: App, options: InstallPluginsOptions = {}): App {
  app.use(i18nPlugin, options.i18n ?? {})
  return app
}

/**
 * Proxy Vue instance hiện tại — sau `installPlugins`, dùng `app.$t` / `app.$setI18nLocale`.
 * Chỉ gọi trong `<script setup>` / composable (có currentInstance).
 * Scripts/pure ngoài setup: `import { t } from '@/plugins/i18n'`.
 */
export function useApp(): ComponentPublicInstance {
  const inst = getCurrentInstance()
  if (!inst?.proxy) {
    throw new Error('[plugins] useApp() chỉ gọi trong setup sau installPlugins(app)')
  }
  return inst.proxy
}

export {
  i18n,
  i18nPlugin,
  injectI18nHelpers,
  t,
  setI18nLocale,
  registerLocale,
  getLocaleRegistry,
  I18N_REGISTRY_KEY,
  I18N_HELPERS_KEY,
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  type AppLocale,
  type LocaleRegistry,
  type I18nHelpers,
  type Messages,
} from './i18n'
