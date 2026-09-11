import { ref, computed } from 'vue'
import type { Ref } from 'vue'
import { useDebounceFn } from '@vueuse/core'

/**
 * Debounced search filter. Returns { query, setQuery, filteredItems }.
 */
export function useSearch<T>(itemsRef: Ref<T[]>, getText: (item: T) => string, debounceMs = 150) {
  const query = ref('')
  const debouncedQuery = ref('')

  const updateDebounced = useDebounceFn((v: string) => {
    debouncedQuery.value = v
  }, debounceMs)

  const setQuery = (v: string) => {
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
