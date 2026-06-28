import { ref } from 'vue'
import type { Ref } from 'vue'

/** Reorder list items via HTML5 drag-and-drop. */
export function useSortable<T>(listRef: Ref<T[]>, onReorder?: (items: T[]) => void) {
  const dragIndex = ref<number | null>(null)

  function onDragStart(index: number) {
    dragIndex.value = index
  }

  function onDragOver(event: DragEvent, index: number) {
    event.preventDefault()
    if (dragIndex.value === null || dragIndex.value === index) return
    const items = [...listRef.value]
    const [moved] = items.splice(dragIndex.value, 1)
    items.splice(index, 0, moved)
    listRef.value = items
    dragIndex.value = index
    onReorder?.(items)
  }

  function onDragEnd() {
    dragIndex.value = null
  }

  return { dragIndex, onDragStart, onDragOver, onDragEnd }
}
