import type { App, InjectionKey, Plugin } from 'vue'
import type { DashboardPlugin } from '@shared/host/contract'
import { createHostContext, type HostContext } from './hostContext'

export const HOST_CTX_KEY: InjectionKey<HostContext> = Symbol('hostContext')

/**
 * Thin Vue adapter around the framework-agnostic `DashboardPlugin` contract —
 * activates every built-in against one shared `HostContext` at boot, then
 * `provide`s it for `useHostContext()` to read (see issue #159 / design.md §3.4).
 */
export const HostPlugin: Plugin<{ plugins: DashboardPlugin<HostContext>[] }> = {
  install(app: App, options: { plugins: DashboardPlugin<HostContext>[] }) {
    const ctx = createHostContext()
    for (const plugin of options.plugins) {
      plugin.activate(ctx)
    }
    app.provide(HOST_CTX_KEY, ctx)
  },
}
