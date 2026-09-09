import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendBrowserNotification } from '@/features/notifications/lib/browserNotification'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sendBrowserNotification', () => {
  it('does nothing when Notification is unavailable', () => {
    vi.stubGlobal('Notification', undefined)
    expect(() => sendBrowserNotification('id1', 'hello')).not.toThrow()
  })

  it('does nothing when permission is not granted', () => {
    const ctor = vi.fn()
    vi.stubGlobal('Notification', Object.assign(ctor, { permission: 'denied' }))
    sendBrowserNotification('id1', 'hello')
    expect(ctor).not.toHaveBeenCalled()
  })

  it('constructs a Notification with the message and id as tag when granted', () => {
    const ctor = vi.fn()
    vi.stubGlobal('Notification', Object.assign(ctor, { permission: 'granted' }))
    sendBrowserNotification('id1', 'hello')
    expect(ctor).toHaveBeenCalledWith('hello', { tag: 'id1' })
  })

  it('swallows errors thrown by the Notification constructor', () => {
    const ctor = vi.fn(() => {
      throw new Error('boom')
    })
    vi.stubGlobal('Notification', Object.assign(ctor, { permission: 'granted' }))
    expect(() => sendBrowserNotification('id1', 'hello')).not.toThrow()
  })
})
