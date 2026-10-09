import { useDropZone } from '@vueuse/core'
import type { Ref } from 'vue'

/** Thin wrapper around VueUse `useDropZone`. */
export function useDrop(
  targetRef: Ref<HTMLElement | null | undefined>,
  onDrop: (files: File[] | null, event: DragEvent) => void,
) {
  return useDropZone(targetRef, { onDrop })
}
