import { describe, expect, it } from 'vitest'
import { createApp, defineComponent, h } from 'vue'
import { HostPlugin, HOST_CTX_KEY } from '@/shared/host/vuePlugin'
import { useHostContext } from '@/shared/host/useHostContext'
import type { DashboardPlugin } from '@shared/host/contract'
import type { HostContext } from '@/shared/host/hostContext'

function mountWithHost(plugins: DashboardPlugin<HostContext>[]) {
  const root = document.createElement('div')
  const app = createApp(defineComponent({ setup: () => () => h('div') }))
  app.use(HostPlugin, { plugins })
  app.mount(root)
  return app
}

describe('HostPlugin', () => {
  it('activates every plugin against one shared HostContext and provides it', () => {
    const activated: string[] = []
    const plugins: DashboardPlugin<HostContext>[] = [
      { id: 'a', activate: (ctx) => { activated.push('a'); ctx.registerMode({ id: 'a', labelKey: 'a', icon: 'monitor', entry: {} as any }) } },
      { id: 'b', activate: () => { activated.push('b') } },
    ]

    const app = mountWithHost(plugins)
    expect(activated).toEqual(['a', 'b'])
    expect(app._context.provides[HOST_CTX_KEY as unknown as string].modes.map((m: any) => m.id)).toEqual(['a'])
  })
})

describe('useHostContext', () => {
  it('throws when called outside an app using HostPlugin', () => {
    const app = createApp(defineComponent({
      setup() {
        expect(() => useHostContext()).toThrow(/outside an app using HostPlugin/)
        return () => h('div')
      },
    }))
    app.mount(document.createElement('div'))
  })
})
