import { describe, expect, it } from 'vitest'
import { mountWithI18n } from '../../../helpers/i18n'
import NotificationBell from '@/features/notifications/components/NotificationBell.vue'
import type { NotificationEvent } from '@/features/notifications/lib/notificationTypes'

function event(over: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    id: 't1:qa_ready',
    taskId: 't1',
    kind: 'qa_ready',
    detail: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    read: false,
    ...over,
  }
}

describe('NotificationBell', () => {
  it('shows the unread badge only when there are unread notifications', async () => {
    const wrapper = mountWithI18n(NotificationBell, { props: { unreadCount: 0, history: [] } })
    expect(wrapper.find('.bell-badge').exists()).toBe(false)
    expect(wrapper.find('.bell-btn').classes()).not.toContain('has-unread')

    await wrapper.setProps({ unreadCount: 3 })
    expect(wrapper.find('.bell-badge').text()).toBe('3')
    expect(wrapper.find('.bell-btn').classes()).toContain('has-unread')
    expect(wrapper.find('.bell-icon').exists()).toBe(true)
  })

  it('opens the dropdown on click and lists history entries', async () => {
    const wrapper = mountWithI18n(NotificationBell, {
      props: { unreadCount: 1, history: [event()] },
    })
    expect(wrapper.find('.bell-dropdown').exists()).toBe(false)

    await wrapper.find('.bell-btn').trigger('click')
    expect(wrapper.find('.bell-dropdown').exists()).toBe(true)
    expect(wrapper.findAll('.notification-list-item')).toHaveLength(1)
  })

  it('emits select when an item is clicked and markAllRead on the header button', async () => {
    const wrapper = mountWithI18n(NotificationBell, {
      props: { unreadCount: 1, history: [event()] },
    })
    await wrapper.find('.bell-btn').trigger('click')

    await wrapper.find('.notification-list-item').trigger('click')
    expect(wrapper.emitted('select')?.[0]?.[0]).toMatchObject({ id: 't1:qa_ready' })

    await wrapper.find('.notification-list-mark-all').trigger('click')
    expect(wrapper.emitted('markAllRead')).toHaveLength(1)
  })

  it('shows the empty state when history is empty', async () => {
    const wrapper = mountWithI18n(NotificationBell, { props: { unreadCount: 0, history: [] } })
    await wrapper.find('.bell-btn').trigger('click')
    expect(wrapper.find('.notification-list-empty').exists()).toBe(true)
    expect(wrapper.find('.notification-list-mark-all').exists()).toBe(false)
  })
})
