import { createI18n } from 'vue-i18n'
import type { LocalePreference } from '../contracts/schemas/appSettings'
import { vi } from './locales/vi'
import { en } from './locales/en'
import './types'

export type AppLocale = LocalePreference
export const SUPPORTED_LOCALES: readonly AppLocale[] = ['vi', 'en']
export const DEFAULT_LOCALE: AppLocale = 'vi'

// Composition mode (legacy:false) → `useI18n()` in <script setup>. Full build
// (with the message compiler) is used deliberately: message resources are `.ts`
// objects and the app is small, so the runtime-only + precompile pipeline is not
// worth its config fragility here (can revisit if bundle size ever matters).
export const i18n = createI18n({
  legacy: false,
  locale: DEFAULT_LOCALE,
  fallbackLocale: DEFAULT_LOCALE,
  messages: { vi, en },
})

/** Switch the active UI locale (does not persist — see useLocale). */
export function setI18nLocale(locale: AppLocale): void {
  i18n.global.locale.value = locale
}
