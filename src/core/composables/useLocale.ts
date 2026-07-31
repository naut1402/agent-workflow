import { computed, type ComputedRef } from 'vue'
import {
  resolveLocale,
  type LocalePreference,
} from '../contracts/schemas/appSettings'
import { useAppSettings } from './useAppSettings'
import { setI18nLocale } from '../i18n'

/**
 * Reactive UI-locale preference backed by the shared app-settings store
 * (persisted to localStorage, same as theme). Switching updates both the
 * persisted preference and the live vue-i18n locale.
 */
export function useLocale(): {
  locale: ComputedRef<LocalePreference>
  setLocale: (next: LocalePreference) => void
} {
  const { settings, update } = useAppSettings()
  const locale = computed(() => resolveLocale(settings.value))

  function setLocale(next: LocalePreference): void {
    if (locale.value === next) return
    update({ locale: next })
    setI18nLocale(next)
  }

  return { locale, setLocale }
}
