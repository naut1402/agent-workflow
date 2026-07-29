import { describe, expect, it, vi } from 'vitest'
import { createHostContext } from '@/shared/host/hostContext'

describe('createHostContext', () => {
  it('registers modes and floatings', () => {
    const ctx = createHostContext()
    ctx.registerMode({ id: 'monitor', labelKey: 'common.modes.monitor', icon: 'monitor', entry: {} as any })
    ctx.registerFloating({ id: 'notifications', entry: {} as any })

    expect(ctx.modes.map((m) => m.id)).toEqual(['monitor'])
    expect(ctx.floatings.map((f) => f.id)).toEqual(['notifications'])
  })

  it('throws when a mode id is registered twice', () => {
    const ctx = createHostContext()
    ctx.registerMode({ id: 'monitor', labelKey: 'common.modes.monitor', icon: 'monitor', entry: {} as any })

    expect(() =>
      ctx.registerMode({ id: 'monitor', labelKey: 'common.modes.monitor', icon: 'monitor', entry: {} as any }),
    ).toThrow(/already registered/)
  })

  it('throws when a floating id is registered twice', () => {
    const ctx = createHostContext()
    ctx.registerFloating({ id: 'notifications', entry: {} as any })

    expect(() => ctx.registerFloating({ id: 'notifications', entry: {} as any })).toThrow(/already registered/)
  })

  it('events.on/emit delivers payloads and unsubscribes', () => {
    const ctx = createHostContext()
    const fn = vi.fn()
    const off = ctx.events.on('topic', fn)

    ctx.events.emit('topic', 42)
    expect(fn).toHaveBeenCalledWith(42)

    off()
    ctx.events.emit('topic', 43)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('api.register/get round-trips a facade, and rejects a duplicate domain', () => {
    const ctx = createHostContext()
    const facade = { hello: () => 'world' }
    ctx.api.register('demo', facade)

    expect(ctx.api.get('demo')).toBe(facade)
    expect(() => ctx.api.register('demo', {})).toThrow(/already registered/)
  })

  it('i18n.merge is a no-op that does not throw (reserved seam, see design.md §6)', () => {
    const ctx = createHostContext()
    expect(() => ctx.i18n.merge('vi', 'demo', { hello: 'xin chào' })).not.toThrow()
  })
})
