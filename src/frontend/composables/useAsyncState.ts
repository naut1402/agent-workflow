import { useAsyncState as _useAsyncState } from '@vueuse/core'

/**
 * Async state wrapper around VueUse useAsyncState.
 * Returns { state, isLoading, error, execute }.
 */
export function useAsyncState<T>(
  fn: (...args: any[]) => Promise<T>,
  initialState: T,
  opts: { immediate?: boolean } = {},
) {
  const { state, isLoading, error, execute } = _useAsyncState(fn, initialState, {
    immediate: opts.immediate !== false,
    resetOnExecute: false,
  })
  return { state, isLoading, error, execute }
}
