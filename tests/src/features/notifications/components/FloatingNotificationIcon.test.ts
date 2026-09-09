import { describe, expect, it } from 'vitest'
import { mountWithI18n } from '../../../helpers/i18n'
import FloatingNotificationIcon from '@/features/notifications/components/FloatingNotificationIcon.vue'
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

describe('FloatingNotificationIcon', () => {
  it('is hidden when there is nothing unread', () => {
    const wrapper = mountWithI18n(FloatingNotificationIcon, { props: { unreadCount: 0, history: [] } })
    expect(wrapper.find('.floating-notification').exists()).toBe(false)
  })

  it('shows the badge count and hides again once unreadCount drops to 0 (read)', async () => {
    const wrapper = mountWithI18n(FloatingNotificationIcon, {
      props: { unreadCount: 2, history: [event(), event({ id: 't2:qa_ready', kind: 'qa_ready' })] },
    })
    expect(wrapper.find('.floating-notification-badge').text()).toBe('2')

    await wrapper.setProps({ unreadCount: 0, history: [] })
    expect(wrapper.find('.floating-notification').exists()).toBe(false)
  })

  it('opens the dropdown on click and emits select for an item', async () => {
    const wrapper = mountWithI18n(FloatingNotificationIcon, {
      props: { unreadCount: 1, history: [event()] },
    })
    expect(wrapper.find('.floating-notification-dropdown').exists()).toBe(false)

    await wrapper.find('.floating-notification-btn').trigger('click')
    expect(wrapper.find('.floating-notification-dropdown').exists()).toBe(true)

    await wrapper.find('.notification-list-item').trigger('click')
    expect(wrapper.emitted('select')?.[0]?.[0]).toMatchObject({ id: 't1:hitl_pending' })
  })
})
