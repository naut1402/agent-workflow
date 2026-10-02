import { computed, getCurrentInstance, type ComputedRef, type Ref } from 'vue'
import {
  resolveLocale,
  type LocalePreference,
} from '../configs/appSettings'
import { useAppSettings } from './useAppSettings'
import { useLocaleMessages } from './useLocaleMessages'
import { setI18nLocale as setI18nLocaleFallback } from '../plugins/i18n'

/**
 * Locale người dùng yêu cầu gần nhất, kể cả khi lượt nạp của nó chưa xong. `null` =
 * không có lượt nào đang bay, mốc so sánh là locale đang áp dụng.
 *
 * Module scope (không phải trong `useLocale()`): hai component cùng gọi `setLocale`
 * phải nhìn chung một dòng thời gian, nếu không mỗi cái lại tự cho mình là mới nhất.
 */
let requestedLocale: LocalePreference | null = null

/**
 * Reactive UI-locale preference backed by the shared app-settings store
 * (persisted to localStorage, same as theme). Switching updates both the
 * persisted preference and the live vue-i18n locale
 * (`getCurrentInstance()!.appContext.config.globalProperties.$setI18nLocale`).
 *
 * `setLocale` là async vì locale chưa nạp phải lấy messages trước khi đổi — nhưng
 * locale ĐÃ nạp thì đổi ngay, không chạm mạng (tiêu chí 2 của request).
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

  /**
   * Yêu cầu MỚI NHẤT thắng (G-C12). So với `requestedLocale` chứ không phải
   * `locale.value`: bấm `en` rồi bấm ngay `vi`, lượt `vi` vào khi lượt `en` chưa kịp
   * `update()` — lấy `locale.value` làm mốc thì lượt `vi` tưởng mình là no-op, rồi
   * lượt `en` về sau ghi đè, app dừng ở đúng cái người dùng vừa bỏ chọn.
   */
  async function setLocale(next: LocalePreference): Promise<void> {
    if ((requestedLocale ?? locale.value) === next) return
    requestedLocale = next

    // Quay về đúng locale đang áp dụng → chỉ là huỷ lượt đang bay, không phải nạp gì.
    if (next === locale.value) {
      requestedLocale = null
      return
    }

    // Đã nạp rồi → đổi NGAY, không chạm mạng.
    const ok = loadedLocales.value.includes(next) ? true : await ensureLocale(next)

    // Trong lúc await, người dùng đã chọn locale khác → lượt này lỗi thời, bỏ kết quả.
    if (requestedLocale !== next) return
    requestedLocale = null

    // Nạp thất bại → GIỮ locale cũ; `lastError` hiện ngay tại control chọn ngôn ngữ.
    if (!ok) return
    update({ locale: next })
    applyLocale(next)
  }

  return { locale, setLocale, pending, lastError }
}
