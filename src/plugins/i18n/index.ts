import type { App, InjectionKey, Plugin } from 'vue'
import { createI18n } from 'vue-i18n'
import type { LocalePreference } from '../../core/configs/appSettings'
import { loadLocaleMessages } from './loadLocales'

declare module 'vue' {
  interface ComponentCustomProperties {
    /** Đổi locale (plugin i18n) — `globalProperties.$setI18nLocale`. */
    $setI18nLocale: (locale: LocalePreference) => void
    $localeRegistry: {
      locales: string[]
      defaultLocale: string
    }
  }
}

export type AppLocale = LocalePreference

export const DEFAULT_LOCALE: AppLocale = 'vi'

/** Registry locale đã gắn lên app (có thể mở rộng runtime). */
export type LocaleRegistry = {
  /** Mã locale đang hỗ trợ (mutable khi `registerLocale`). */
  locales: string[]
  defaultLocale: string
}

/**
 * Helpers i18n — inject vào Vue app (provide + globalProperties).
 * Trong setup: `const { t } = useI18nHelpers()` (`src/core/composables/useI18nHelpers`).
 */
export type I18nHelpers = {
  t: (...args: any[]) => string
  setLocale: (locale: AppLocale) => void
  registry: LocaleRegistry
}

const localeRegistry: LocaleRegistry = {
  locales: [],
  defaultLocale: DEFAULT_LOCALE,
}

export function getLocaleRegistry(): LocaleRegistry {
  return localeRegistry
}

export { loadLocaleMessages }

const loaded = loadLocaleMessages()
const initialLocales = Object.keys(loaded)
if (!initialLocales.includes(DEFAULT_LOCALE)) {
  throw new Error(`[i18n] missing default locale messages: ${DEFAULT_LOCALE}`)
}
localeRegistry.locales = initialLocales.includes('en')
  ? ['vi', 'en', ...initialLocales.filter((l) => l !== 'vi' && l !== 'en')]
  : initialLocales

export const SUPPORTED_LOCALES: readonly AppLocale[] = ['vi', 'en']

export const i18n = createI18n({
  legacy: false,
  locale: DEFAULT_LOCALE,
  fallbackLocale: DEFAULT_LOCALE,
  messages: loaded as any,
})

export const I18N_REGISTRY_KEY: InjectionKey<LocaleRegistry> = Symbol('dev-team-i18n-registry')
export const I18N_HELPERS_KEY: InjectionKey<I18nHelpers> = Symbol('dev-team-i18n-helpers')

/** App đã `install` plugin — dùng cho helper ngoài setup (scripts/pure fn). */
let installedApp: App | null = null

/** Đổi locale đang active (không persist — xem useLocale). */
export function setI18nLocale(locale: AppLocale): void {
  i18n.global.locale.value = locale
}

/**
 * Translate qua Vue instance đã inject (`$t`), fallback singleton trước mount.
 * Dùng trong scripts / pure fn không có setup context.
 */
export function t(...args: any[]): string {
  const gp = installedApp?.config.globalProperties as { $t?: (...a: any[]) => string } | undefined
  if (gp?.$t) return gp.$t(...args)
  return (i18n.global as any).t(...args)
}

function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      base[k] &&
      typeof base[k] === 'object' &&
      !Array.isArray(base[k])
    ) {
      out[k] = deepMerge(base[k] as Record<string, unknown>, v as Record<string, unknown>)
    } else {
      out[k] = v
    }
  }
  return out
}

/**
 * Đăng ký / bổ sung locale vào registry + vue-i18n (app scope).
 * `messages` là object theo namespace (vd `{ common: {...}, monitor: {...} }`).
 */
export function registerLocale(locale: string, messages: Record<string, unknown>): void {
  const existing = (i18n.global.getLocaleMessage(locale) || {}) as Record<string, unknown>
  i18n.global.setLocaleMessage(locale, deepMerge(existing, messages) as any)
  if (!localeRegistry.locales.includes(locale)) {
    localeRegistry.locales.push(locale)
  }
}

/**
 * Tạo helpers và gắn lên app instance (provide + `$t` / `$setI18nLocale` global).
 * Chỉ gọi từ `i18nPlugin.install` — feature dùng `useI18nHelpers()` (core/composables).
 */
export function injectI18nHelpers(app: App): I18nHelpers {
  const helpers: I18nHelpers = {
    t: ((...args: any[]) => t(...args)) as I18nHelpers['t'],
    setLocale: setI18nLocale,
    registry: localeRegistry,
  }
  app.provide(I18N_HELPERS_KEY, helpers)
  app.provide(I18N_REGISTRY_KEY, localeRegistry)
  // vue-i18n đã gắn `$t`; bổ sung helper app-scope còn lại.
  Object.assign(app.config.globalProperties, {
    $localeRegistry: localeRegistry,
    $setI18nLocale: setI18nLocale,
  })
  return helpers
}

export type I18nPluginOptions = {
  /** Locale ban đầu (thường từ AppSettings). */
  locale?: AppLocale
}

export const i18nPlugin: Plugin<I18nPluginOptions> = {
  install(app: App, options: I18nPluginOptions = {}) {
    installedApp = app
    if (options.locale) setI18nLocale(options.locale)
    app.use(i18n)
    injectI18nHelpers(app)
  },
}
