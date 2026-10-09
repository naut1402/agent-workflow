import type { App } from 'vue'
import type { Container } from '../container'
import { containerKey } from '../shell/containerKey'
import { i18nPlugin, type I18nPluginOptions } from './i18n'

export type InstallPluginsOptions = {
  i18n?: I18nPluginOptions
  container?: Container
}

/** Cài plugin app-scope (i18n, service container) tại một chỗ; chỉ gọi từ `main.ts`. */
export function installPlugins(app: App, options: InstallPluginsOptions = {}): App {
  app.use(i18nPlugin, options.i18n ?? {})
  if (options.container) {
    app.provide(containerKey, options.container)
  }
  return app
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
  loadLocaleMessages,
} from './i18n'
