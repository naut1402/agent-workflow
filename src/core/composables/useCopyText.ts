import { onUnmounted, ref } from 'vue'
import { useI18nHelpers } from './useI18nHelpers'

/**
 * Copy-to-clipboard with a short "đã copy" flash — the pattern LogsPanel.vue
 * grew first, lifted here so the chat message bubbles reuse it instead of a
 * second copy of the `execCommand` fallback.
 *
 * Strings live in the `common.copy.*` namespace: a `core` composable must not
 * depend on a feature's namespace (`logs.copy.*`).
 */
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
        // Fallback for insecure origins / older browsers, same as LogsPanel.
        const ta = document.createElement('textarea')
        ta.value = value
        ta.style.position = 'fixed'
        ta.style.left = '-9999px'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
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
