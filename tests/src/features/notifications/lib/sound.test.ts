import { afterEach, describe, expect, it, vi } from 'vitest'
import { playNotificationSound } from '@/features/notifications/lib/sound'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubAudioContext() {
  const osc = { type: '', frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() }
  const gain = {
    gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn(),
  }
  const ctor = vi.fn(function (this: any) {
    this.currentTime = 0
    this.destination = {}
    this.createOscillator = () => osc
    this.createGain = () => gain
  })
  vi.stubGlobal('AudioContext', ctor)
  return { ctor, osc, gain }
}

describe('playNotificationSound', () => {
  it('does nothing when AudioContext is unsupported', () => {
    vi.stubGlobal('AudioContext', undefined)
    expect(() => playNotificationSound()).not.toThrow()
  })

  // Runs before the "creates an oscillator" test below — `sound.ts` caches
  // its AudioContext instance at module scope, so once a real one is
  // constructed the throwing stub would never be reached.
  it('swallows errors from an AudioContext that throws', () => {
    vi.stubGlobal(
      'AudioContext',
      vi.fn(() => {
        throw new Error('boom')
      }),
    )
    expect(() => playNotificationSound()).not.toThrow()
  })

  it('creates an oscillator, connects it through a gain node, and starts/stops it', () => {
    const { osc, gain } = stubAudioContext()
    playNotificationSound()
    expect(osc.connect).toHaveBeenCalledWith(gain)
    expect(gain.connect).toHaveBeenCalled()
    expect(osc.start).toHaveBeenCalled()
    expect(osc.stop).toHaveBeenCalled()
  })
})
