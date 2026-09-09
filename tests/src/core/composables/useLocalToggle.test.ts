import { describe, expect, it } from 'vitest'
import { useLocalToggle } from '../../../../src/core/composables/useLocalToggle'

describe('useLocalToggle', () => {
  it('defaults to false and toggles', () => {
    const t = useLocalToggle()
    expect(t.state.value).toBe(false)
    t.toggle()
    expect(t.state.value).toBe(true)
    t.toggle()
    expect(t.state.value).toBe(false)
  })

  it('respects initial value and setTrue/setFalse', () => {
    const t = useLocalToggle(true)
    expect(t.state.value).toBe(true)
    t.setFalse()
    expect(t.state.value).toBe(false)
    t.setTrue()
    expect(t.state.value).toBe(true)
  })
})
