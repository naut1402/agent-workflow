import type { LocalePreference } from '../../core/contracts/schemas/appSettings'

declare module 'vue' {
  interface ComponentCustomProperties {
    /** Đổi locale (plugin i18n) — `getCurrentInstance()!.appContext.config.globalProperties.$setI18nLocale`. */
    $setI18nLocale: (locale: LocalePreference) => void
    $localeRegistry: {
      locales: string[]
      defaultLocale: string
    }
  }
}

export {}
