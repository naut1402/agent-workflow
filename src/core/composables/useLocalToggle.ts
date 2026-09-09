import { useToggle } from '@vueuse/core'

/** Boolean toggle wrapper around VueUse useToggle. */
export function useLocalToggle(initial = false) {
  const [state] = useToggle(initial)
  return {
    state,
    toggle: () => {
      state.value = !state.value
    },
    setTrue: () => {
      state.value = true
    },
    setFalse: () => {
      state.value = false
    },
  }
}
