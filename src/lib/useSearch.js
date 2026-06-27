import { ref, computed } from 'vue'
import { useDebounceFn } from '@vueuse/core'

/**
 * Debounced search filter.
 * Returns { query, filteredItems } — components bind `query` to an input and
 * consume `filteredItems` for rendering.
 *
 * @param {import('vue').Ref<Array>} itemsRef  - reactive array to filter
 * @param {(item: any) => string} getText      - extract searchable text from an item
 * @param {number} [debounceMs=150]
 */
export function useSearch(itemsRef, getText, debounceMs = 150) {
  const query = ref('')
  const debouncedQuery = ref('')

  const updateDebounced = useDebounceFn((v) => {
    debouncedQuery.value = v
  }, debounceMs)

  // Keep debouncedQuery in sync whenever query changes.
  const setQuery = (v) => {
    query.value = v
    updateDebounced(v)
  }

  const filteredItems = computed(() => {
    const q = debouncedQuery.value.trim().toLowerCase()
    if (!q) return itemsRef.value
    return itemsRef.value.filter((item) => getText(item).toLowerCase().includes(q))
  })

  return { query, setQuery, filteredItems }
}
