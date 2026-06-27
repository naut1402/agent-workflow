import { useToggle } from '@vueuse/core'

/**
 * Boolean toggle wrapper around VueUse useToggle.
 *
 * @param {boolean} [initial=false]
 * @returns {{ state: import('vue').Ref<boolean>, toggle: () => void, setTrue: () => void, setFalse: () => void }}
 */
export function useLocalToggle(initial = false) {
  const [state, toggle] = useToggle(initial)
  return {
    state,
    toggle: () => { state.value = !state.value },
    setTrue: () => { state.value = true },
    setFalse: () => { state.value = false },
  }
}
