import type { Messages } from './locales/vi'

// Make `t()` / `useI18n()` key-safe app-wide: keys are checked against the vi
// message schema, so a typo or a key removed from vi is a compile error.
declare module 'vue-i18n' {
  export interface DefineLocaleMessage extends Messages {}
}

export {}
