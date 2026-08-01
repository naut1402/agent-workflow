import { getCurrentInstance } from 'vue'

/**
 * Translate qua `$t` đã inject trên Vue app (`installPlugins` / i18nPlugin).
 * Chỉ gọi trong `<script setup>` / composable (đồng bộ lúc setup).
 */
export function useI18nHelpers(): {
  t: (...args: any[]) => string
} {
  const inst = getCurrentInstance()
  if (!inst) {
    throw new Error('[i18n] useI18nHelpers() chỉ gọi trong setup sau installPlugins')
  }
  const gp = inst.appContext.config.globalProperties
  const translate = gp.$t as (...args: any[]) => string
  const t = (...args: any[]): string => translate(...args)
  return { t }
}
