import { onMounted, onUnmounted } from 'vue'

const stack: symbol[] = []

/**
 * Register the calling dialog in a mount-ordered stack so that only the topmost
 * open dialog reacts to global keys (Escape).
 */
export function useDialogStack(): { isTop: () => boolean } {
  const token = Symbol('dialog')
  onMounted(() => {
    stack.push(token)
  })
  onUnmounted(() => {
    const i = stack.indexOf(token)
    if (i >= 0) stack.splice(i, 1)
  })
  return { isTop: () => stack[stack.length - 1] === token }
}
