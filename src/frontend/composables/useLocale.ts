import { computed, getCurrentInstance, type ComputedRef } from 'vue'
import {
  resolveLocale,
  type LocalePreference,
} from '../configs/appSettings'
import { useAppSettings } from './useAppSettings'
import { setI18nLocale as setI18nLocaleFallback } from '../plugins/i18n'

/**
 * Reactive UI-locale preference backed by app settings (localStorage); switching updates
 * both the stored preference and the live vue-i18n locale.
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
