import { computed, getCurrentInstance, type ComputedRef } from 'vue'
import {
  resolveLocale,
  type LocalePreference,
} from '../contracts/schemas/appSettings'
import { useAppSettings } from './useAppSettings'
import { setI18nLocale as setI18nLocaleFallback } from '../../plugins/i18n'

/**
 * Reactive UI-locale preference backed by the shared app-settings store
 * (persisted to localStorage, same as theme). Switching updates both the
 * persisted preference and the live vue-i18n locale (via app.$setI18nLocale).
 */
export function useLocale(): {
  locale: ComputedRef<LocalePreference>
  setLocale: (next: LocalePreference) => void
} {
  const { settings, update } = useAppSettings()
  const gp = getCurrentInstance()?.appContext.config.globalProperties as
    | { $setI18nLocale?: (locale: LocalePreference) => void }
    | undefined
  const applyLocale = gp?.$setI18nLocale ?? setI18nLocaleFallback
  const locale = computed(() => resolveLocale(settings.value))

  function setLocale(next: LocalePreference): void {
    if (locale.value === next) return
    update({ locale: next })
    applyLocale(next)
  }

  return { locale, setLocale }
}
