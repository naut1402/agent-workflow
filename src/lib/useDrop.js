import { useDropZone } from '@vueuse/core'

/**
 * Thin wrapper around VueUse useDropZone.
 * Components call useDrop(targetRef, onDrop) instead of useDropZone directly,
 * so upgrading VueUse only touches this file.
 *
 * @param {import('vue').Ref<HTMLElement|null>} targetRef
 * @param {(files: File[], event: DragEvent) => void} onDrop
 */
export function useDrop(targetRef, onDrop) {
  return useDropZone(targetRef, { onDrop })
}
