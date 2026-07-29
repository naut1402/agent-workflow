import { describe, expect, it } from 'vitest'
import { createHostContext } from '@/shared/host/hostContext'
import { BUILTIN_PLUGINS } from '@/bootstrap/builtinPlugins'

describe('BUILTIN_PLUGINS', () => {
  it('activates all 8 built-ins against a fresh HostContext without id collisions', () => {
    const ctx = createHostContext()

    for (const plugin of BUILTIN_PLUGINS) {
      expect(() => plugin.activate(ctx)).not.toThrow()
    }

    expect(ctx.modes.map((m) => m.id).sort()).toEqual(
      ['agentEditor', 'editor', 'knowledge', 'logs', 'monitor', 'quickAction', 'runner'].sort(),
    )
    expect(ctx.floatings.map((f) => f.id)).toEqual(['notifications'])
    expect(ctx.modes.filter((m) => m.default)).toHaveLength(1)
    expect(ctx.modes.find((m) => m.default)?.id).toBe('monitor')
  })
})
