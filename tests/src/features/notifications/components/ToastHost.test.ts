import { describe, expect, it } from 'vitest'
import { mountWithI18n } from '../../../helpers/i18n'
import ToastHost from '@/features/notifications/components/ToastHost.vue'
import type { NotificationEvent } from '@/features/notifications/lib/notificationTypes'

function event(over: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    id: 't1:hitl_pending',
    taskId: 't1',
    kind: 'hitl_pending',
    detail: 'implement',
    createdAt: '2026-01-01T00:00:00.000Z',
    read: false,
    ...over,
  }
}

describe('ToastHost', () => {
  it('renders nothing when there are no toasts', () => {
    const wrapper = mountWithI18n(ToastHost, { props: { toasts: [] } })
    expect(wrapper.find('.toast-host').exists()).toBe(false)
  })

  it('renders one toast per event and emits select on click', async () => {
    const wrapper = mountWithI18n(ToastHost, { props: { toasts: [event()] } })
    const item = wrapper.find('.toast-item')
    expect(item.exists()).toBe(true)
    await item.trigger('click')
    expect(wrapper.emitted('select')?.[0]?.[0]).toMatchObject({ id: 't1:hitl_pending' })
  })

  it('emits dismiss without emitting select when the close button is clicked', async () => {
    const wrapper = mountWithI18n(ToastHost, { props: { toasts: [event()] } })
    await wrapper.find('.toast-close').trigger('click')
    expect(wrapper.emitted('dismiss')?.[0]).toEqual(['t1:hitl_pending'])
    expect(wrapper.emitted('select')).toBeUndefined()
  })
})
