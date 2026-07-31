// Notifications module — floating icon + bell derived from polled task flags
// (hitl_pending/has_qa). vi is the source of truth for the message schema
// (see en/notifications.ts). `{param}` = named interpolation.
export const notifications = {
  bell: {
    title: 'Thông báo',
    empty: 'Chưa có thông báo nào.',
    markAllRead: 'Đánh dấu đã đọc tất cả',
  },
  message: {
    hitlPending: 'Task {taskId} đang chờ duyệt (HITL)',
    qaReady: 'Task {taskId} đã có QA sẵn sàng',
  },
  flag: {
    unread: 'Chưa đọc',
  },
}
