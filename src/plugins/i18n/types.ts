import type { Messages } from './schema'
import type { LocalePreference } from '../../core/contracts/schemas/appSettings'

declare module 'vue-i18n' {
  export interface DefineLocaleMessage extends Messages {}
}

declare module 'vue' {
  interface ComponentCustomProperties {
    /** Đổi locale (plugin i18n) — dùng `app.$setI18nLocale` / `useApp().$setI18nLocale`. */
    $setI18nLocale: (locale: LocalePreference) => void
    $localeRegistry: {
      locales: string[]
      defaultLocale: string
    }
  }
}

export {}
