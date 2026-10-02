import { computed, getCurrentInstance, type ComputedRef, type Ref } from 'vue'
import {
  resolveLocale,
  type LocalePreference,
} from '../configs/appSettings'
import { useAppSettings } from './useAppSettings'
import { useLocaleMessages } from './useLocaleMessages'
import { setI18nLocale as setI18nLocaleFallback } from '../plugins/i18n'

/** Locale yêu cầu gần nhất còn đang nạp; `null` khi không có lượt nào đang chạy. */
let requestedLocale: LocalePreference | null = null

/**
 * Reactive UI-locale preference backed by the shared app-settings store
 * (persisted to localStorage, same as theme). Switching updates both the
 * persisted preference and the live vue-i18n locale
 * (`getCurrentInstance()!.appContext.config.globalProperties.$setI18nLocale`).
 */
export function useLocale(): {
  locale: ComputedRef<LocalePreference>
  setLocale: (next: LocalePreference) => Promise<void>
  pending: Ref<string | null>
  lastError: Ref<string | null>
} {
  const { settings, update } = useAppSettings()
  const { ensureLocale, loadedLocales, pending, lastError } = useLocaleMessages()
  const gp = getCurrentInstance()?.appContext.config.globalProperties as
    | { $setI18nLocale?: (locale: LocalePreference) => void }
    | undefined
  const applyLocale = gp?.$setI18nLocale ?? setI18nLocaleFallback
  const locale = computed(() => resolveLocale(settings.value))

  /** Yêu cầu mới nhất thắng; nạp thất bại thì giữ locale cũ. */
  async function setLocale(next: LocalePreference): Promise<void> {
    if ((requestedLocale ?? locale.value) === next) return
    requestedLocale = next

    if (next === locale.value) {
      requestedLocale = null
      return
    }

    const ok = loadedLocales.value.includes(next) ? true : await ensureLocale(next)

    if (requestedLocale !== next) return
    requestedLocale = null

    if (!ok) return
    update({ locale: next })
    applyLocale(next)
  }

  return { locale, setLocale, pending, lastError }
}
