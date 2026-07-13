import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { vi as viMessages } from '@/shared/i18n/locales/vi'
import { en as enMessages } from '@/shared/i18n/locales/en'

/** Fresh i18n instance per test — avoids locale bleed across the app singleton. */
export function createTestI18n(locale: 'vi' | 'en' = 'vi') {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'vi',
    messages: { vi: viMessages, en: enMessages },
  })
}

/**
 * `mount` with the vue-i18n plugin installed. Component slices that call
 * `useI18n()` mount through this instead of the raw `mount`.
 */
export function mountWithI18n(component: any, options: Record<string, any> = {}) {
  const { global: g = {}, ...rest } = options
  return mount(component, {
    ...rest,
    global: {
      ...g,
      plugins: [createTestI18n(), ...(g.plugins ?? [])],
    },
  })
}
