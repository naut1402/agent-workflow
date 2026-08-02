import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useSortable } from '../../../../src/core/composables/useSortable'

describe('useSortable', () => {
  it('reorders the list on drag-over and notifies', () => {
    const list = ref(['a', 'b', 'c'])
    const onReorder = vi.fn()
    const { dragIndex, onDragStart, onDragOver, onDragEnd } = useSortable(list, onReorder)

    onDragStart(0)
    expect(dragIndex.value).toBe(0)

    // Drag item 'a' over index 2 → ['b','c','a']
    onDragOver({ preventDefault() {} } as any, 2)
    expect(list.value).toEqual(['b', 'c', 'a'])
    expect(dragIndex.value).toBe(2)
    expect(onReorder).toHaveBeenCalledWith(['b', 'c', 'a'])

    onDragEnd()
    expect(dragIndex.value).toBe(null)
  })

  it('no-ops when dragging over the same index', () => {
    const list = ref([1, 2, 3])
    const { onDragStart, onDragOver } = useSortable(list)
    onDragStart(1)
    onDragOver({ preventDefault() {} } as any, 1)
    expect(list.value).toEqual([1, 2, 3])
  })
})
