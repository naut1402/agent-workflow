import { useDropZone } from '@vueuse/core'
import type { Ref } from 'vue'

/**
 * Thin wrapper around VueUse useDropZone. Components call useDrop(targetRef, onDrop)
 * so upgrading VueUse only touches this file.
 */
export function useDrop(
  targetRef: Ref<HTMLElement | null | undefined>,
  onDrop: (files: File[] | null, event: DragEvent) => void,
) {
  return useDropZone(targetRef, { onDrop })
}
