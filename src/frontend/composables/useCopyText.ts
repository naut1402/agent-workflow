import { onUnmounted, ref } from 'vue'
import { useI18nHelpers } from './useI18nHelpers'

/** Copy-to-clipboard kèm thông báo ngắn (`copyFlash`); fallback `execCommand` khi không có Clipboard API. */
export function useCopyText(opts?: { flashMs?: number }) {
  const { t } = useI18nHelpers()
  const copyFlash = ref('')
  let timer: ReturnType<typeof setTimeout> | null = null

  async function copyText(text: string): Promise<void> {
    const value = String(text ?? '')
    if (!value) return
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
      } else {
        const ta = document.createElement('textarea')
        ta.value = value
        ta.style.position = 'fixed'
        ta.style.left = '-9999px'
        document.body.appendChild(ta)
        ta.select()
        try {
          if (!document.execCommand('copy')) throw new Error('execCommand copy returned false')
        } finally {
          document.body.removeChild(ta)
        }
      }
      copyFlash.value = t('common.copy.done')
    } catch {
      copyFlash.value = t('common.copy.fail')
    }
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      copyFlash.value = ''
    }, opts?.flashMs ?? 1500)
  }

  onUnmounted(() => {
    if (timer) clearTimeout(timer)
  })

  return { copyFlash, copyText }
}
