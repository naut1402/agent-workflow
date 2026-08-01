/**
 * Test / mount helpers — cài vue-i18n + globalProperties
 * (giống production `i18nPlugin`) để feature dùng `useI18nHelpers()`.
 */
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import type { App, Plugin } from 'vue'
import { vi as viMessages, en as enMessages } from '@/plugins/i18n/schema'
import { I18N_HELPERS_KEY, I18N_REGISTRY_KEY, type I18nHelpers } from '@/plugins/i18n'

export function createTestI18n(locale: 'vi' | 'en' = 'vi') {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'vi',
    messages: { vi: viMessages, en: enMessages },
  })
}

/** Plugin test: vue-i18n + inject helpers lên app (globalProperties). */
export function createTestI18nPlugin(locale: 'vi' | 'en' = 'vi'): Plugin {
  const i18n = createTestI18n(locale)
  const registry = { locales: ['vi', 'en'], defaultLocale: 'vi' as const }
  return {
    install(app: App) {
      app.use(i18n)
      const helpers: I18nHelpers = {
        t: ((...args: any[]) => (i18n.global as any).t(...args)) as I18nHelpers['t'],
        setLocale: (next) => {
          i18n.global.locale.value = next
        },
        registry,
      }
      app.provide(I18N_HELPERS_KEY, helpers)
      app.provide(I18N_REGISTRY_KEY, registry)
      Object.assign(app.config.globalProperties, {
        $localeRegistry: registry,
        $setI18nLocale: helpers.setLocale,
      })
    },
  }
}

export function mountWithI18n(component: any, options: Record<string, any> = {}) {
  const { global: g = {}, ...rest } = options
  return mount(component, {
    ...rest,
    global: {
      ...g,
      plugins: [createTestI18nPlugin(), ...(g.plugins ?? [])],
    },
  })
}
