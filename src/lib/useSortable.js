import { ref } from 'vue'

/** Reorder list items via HTML5 drag-and-drop. */
export function useSortable(listRef, onReorder) {
  const dragIndex = ref(null)

  function onDragStart(index) {
    dragIndex.value = index
  }

  function onDragOver(event, index) {
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
