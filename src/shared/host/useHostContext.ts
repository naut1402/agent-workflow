import { inject } from 'vue'
import { HOST_CTX_KEY } from './vuePlugin'
import type { HostContext } from './hostContext'

/** Reads the `HostContext` provided by `HostPlugin` (see `vuePlugin.ts`). */
export function useHostContext(): HostContext {
  const ctx = inject(HOST_CTX_KEY)
  if (!ctx) {
    throw new Error('useHostContext() called outside an app using HostPlugin')
  }
  return ctx
}
