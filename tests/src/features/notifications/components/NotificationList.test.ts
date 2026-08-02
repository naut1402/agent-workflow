import { describe, expect, it } from 'vitest'
import { mountWithI18n } from '../../../helpers/i18n'
import NotificationList from '@/features/notifications/components/NotificationList.vue'
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

describe('NotificationList', () => {
  it('shows the empty state and hides the mark-all button when history is empty', () => {
    const wrapper = mountWithI18n(NotificationList, { props: { history: [] } })
    expect(wrapper.find('.notification-list-empty').exists()).toBe(true)
    expect(wrapper.find('.notification-list-mark-all').exists()).toBe(false)
  })

  it('renders one item per event with the unread dot on unread entries', () => {
    const wrapper = mountWithI18n(NotificationList, {
      props: { history: [event({ read: false }), event({ id: 't2:qa_ready', kind: 'qa_ready', read: true })] },
    })
    const items = wrapper.findAll('.notification-list-item')
    expect(items).toHaveLength(2)
    expect(items[0].classes()).toContain('unread')
    expect(items[0].find('.notification-list-item-dot').exists()).toBe(true)
    expect(items[1].classes()).not.toContain('unread')
    expect(items[1].find('.notification-list-item-dot').exists()).toBe(false)
  })

  it('emits select on item click and markAllRead on the header button', async () => {
    const wrapper = mountWithI18n(NotificationList, { props: { history: [event()] } })
    await wrapper.find('.notification-list-item').trigger('click')
    expect(wrapper.emitted('select')?.[0]?.[0]).toMatchObject({ id: 't1:hitl_pending' })

    await wrapper.find('.notification-list-mark-all').trigger('click')
    expect(wrapper.emitted('markAllRead')).toHaveLength(1)
  })
})
