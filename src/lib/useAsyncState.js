import { useAsyncState as _useAsyncState } from '@vueuse/core'

/**
 * Async state wrapper around VueUse useAsyncState.
 * Returns { state, isLoading, error, execute }.
 *
 * @param {() => Promise<T>} fn      - async function to call
 * @param {T} initialState           - initial value before first resolve
 * @param {{ immediate?: boolean }} [opts]
 */
export function useAsyncState(fn, initialState, opts = {}) {
  const { state, isLoading, error, execute } = _useAsyncState(fn, initialState, {
    immediate: opts.immediate !== false,
    resetOnExecute: false,
  })
  return { state, isLoading, error, execute }
}
